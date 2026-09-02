import { renderPdfPages } from "./pdf.js";
import { parseXml } from "./loader.js";

export async function convertPdfToMusicXml(file, settings, onProgress = () => {}) {
  if (!settings.openaiApiKey?.trim()) {
    throw new Error("Please enter your OpenAI API Key in Settings to convert PDF sheet music.");
  }

  onProgress("Rendering PDF page to image…");
  const pages = await renderPdfPages(file, { scale: 2.0, maxPages: 1 });
  if (!pages.length) throw new Error("Could not read any pages from the uploaded PDF.");

  const targetPage = pages[0];
  const model = settings.openaiModel?.trim() || "GPT-5.6 Luna";
  const prompt = settings.omrPrompt?.trim() || "Convert this sheet music image to valid MusicXML 3.1.";
  const baseUrl = (settings.openaiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");

  onProgress(`Transcribing score with ${model}…`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey.trim()}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: targetPage.dataUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    let errorDetails = `HTTP error ${response.status}`;
    try {
      const errorJson = await response.json();
      errorDetails = errorJson.error?.message || errorDetails;
    } catch { }
    throw new Error(`OpenAI API error: ${errorDetails}`);
  }

  const result = await response.json();
  const rawText = result.choices?.[0]?.message?.content || "";
  const xml = extractXml(rawText);

  if (!xml) throw new Error("The AI model did not return valid MusicXML markup.");

  onProgress("Validating generated score…");
  const document = parseXml(xml);
  const title = document.querySelector("work-title, movement-title")?.textContent?.trim() || file.name.replace(/\.[^.]+$/, "");
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    xml,
    title,
    filename: `${baseName}.musicxml`,
    pageInfo: `Page ${targetPage.pageNumber} of ${targetPage.totalPages}`,
  };
}

export function extractXml(text) {
  const match = text.match(/```(?:xml|musicxml)?\s*([\s\S]*?)```/i);
  if (match) {
    const candidate = match[1].trim();
    if (candidate.startsWith("<?xml") || candidate.includes("<score-partwise") || candidate.includes("<score-timewise")) {
      return candidate;
    }
  }

  const startIdx = text.indexOf("<?xml");
  const endIdx = text.lastIndexOf("</score-partwise>");
  if (startIdx !== -1 && endIdx !== -1) {
    return text.substring(startIdx, endIdx + "</score-partwise>".length).trim();
  }

  const timewiseEnd = text.lastIndexOf("</score-timewise>");
  if (startIdx !== -1 && timewiseEnd !== -1) {
    return text.substring(startIdx, timewiseEnd + "</score-timewise>".length).trim();
  }

  return text.trim();
}

export function downloadFile(filename, content, type = "application/vnd.recordare.musicxml+xml") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
