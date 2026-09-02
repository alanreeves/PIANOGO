import { parseXml } from "./loader.js";

export async function transcribeSnippet({ snippetDataUrl, startBar, endBar, timeSignature = "4/4", settings, onProgress = () => {} }) {
  if (!settings.openaiApiKey?.trim()) {
    throw new Error("Please enter your OpenAI API Key in Settings for AI piano audio playback.");
  }

  const model = settings.openaiModel?.trim() || "GPT-5.6 Luna";
  const baseUrl = (settings.openaiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const numBars = endBar - startBar + 1;

  let prompt = settings.omrPrompt?.trim();
  if (prompt) {
    prompt = prompt
      .replace(/\{timeSignature\}/g, timeSignature)
      .replace(/\{numBars\}/g, String(numBars))
      .replace(/\{startBar\}/g, String(startBar))
      .replace(/\{endBar\}/g, String(endBar));
  } else {
    prompt = `You are an expert MusicXML transcriber.
Analyze this sheet music snippet containing exactly ${numBars} bar(s) (numbered Bars ${startBar} to ${endBar}).
Time signature is ${timeSignature}.

STRICT REQUIREMENTS:
1. Generate valid, complete MusicXML 3.1 score-partwise XML for a two-staff piano part (Staff 1 = Treble, Staff 2 = Bass).
2. Exactly ${numBars} measure(s) must be generated.
3. Keep exact rhythm, pitches, accidentals, chords, and rests.
4. Output ONLY the raw XML inside a \`\`\`xml code block.`;
  }

  onProgress(`AI transcribing Bars ${startBar}–${endBar} with ${model}…`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey.trim()}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: snippetDataUrl, detail: "high" } },
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

  if (!xml) throw new Error("Could not extract MusicXML for snippet.");
  return { xml, document: parseXml(xml) };
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
