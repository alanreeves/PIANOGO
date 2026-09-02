const XML_EXTENSIONS = new Set(["xml", "musicxml", "mxl"]);

export function decodeXmlBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes).replace(/^\uFEFF/, "").trim();
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes).replace(/^\uFEFF/, "").trim();
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.replace(/^\uFEFF/, "").trim();
}

export async function readScoreFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!XML_EXTENSIONS.has(extension)) throw new Error("Choose a .musicxml, .xml, or .mxl score file.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Scores must be smaller than 20 MB.");
  const bytes = await file.arrayBuffer();
  const xml = extension === "mxl" ? await readMxl(bytes) : decodeXmlBytes(bytes);
  const document = parseXml(xml);
  const metadata = getMetadata(document, file.name);
  return {
    id: await scoreId(xml, file.name),
    name: file.name,
    xml,
    ...metadata,
  };
}

export function parseXml(xml) {
  const clean = typeof xml === "string" ? xml.replace(/^\uFEFF/, "").trim() : xml;
  const document = new DOMParser().parseFromString(clean, "application/xml");
  if (document.querySelector("parsererror")) {
    const fallback = new DOMParser().parseFromString(clean, "text/xml");
    if (!fallback.querySelector("parsererror") && fallback.querySelector("score-partwise, score-timewise")) {
      return fallback;
    }
    throw new Error("This file is not valid MusicXML.");
  }
  if (!document.querySelector("score-partwise, score-timewise")) throw new Error("The uploaded XML is not a MusicXML score.");
  return document;
}

export function transformClefs(xml, { upper = "auto", lower = "auto" } = {}) {
  if (upper === "auto" && lower === "auto") return xml;
  const document = parseXml(xml);
  const part = document.querySelector("part");
  if (!part) return xml;

  const measures = [...part.children].filter((element) => element.localName === "measure");
  measures.forEach((measure, index) => {
    let attributes = [...measure.children].find((child) => child.localName === "attributes");
    if (!attributes && index === 0) {
      attributes = document.createElement("attributes");
      measure.insertBefore(attributes, measure.firstChild);
    }
    if (attributes) {
      const clefs = [...attributes.children].filter((child) => child.localName === "clef");
      clefs.forEach((clef) => {
        const staffNum = Number(clef.getAttribute("number") || "1") || 1;
        const target = staffNum === 1 ? upper : staffNum === 2 ? lower : "auto";
        if (target === "treble") {
          applyClef(clef, "G", "2");
        } else if (target === "bass") {
          applyClef(clef, "F", "4");
        }
      });

      if (index === 0) {
        if (upper !== "auto" && !clefs.some((c) => (Number(c.getAttribute("number") || "1") || 1) === 1)) {
          const newClef = document.createElement("clef");
          newClef.setAttribute("number", "1");
          applyClef(newClef, upper === "treble" ? "G" : "F", upper === "treble" ? "2" : "4");
          attributes.appendChild(newClef);
        }
        const stavesEl = [...attributes.children].find((child) => child.localName === "staves");
        const stavesCount = Number(stavesEl?.textContent?.trim() || "1") || 1;
        if (lower !== "auto" && stavesCount >= 2 && !clefs.some((c) => Number(c.getAttribute("number")) === 2)) {
          const newClef = document.createElement("clef");
          newClef.setAttribute("number", "2");
          applyClef(newClef, lower === "treble" ? "G" : "F", lower === "treble" ? "2" : "4");
          attributes.appendChild(newClef);
        }
      }
    }
  });

  return new XMLSerializer().serializeToString(document);
}

function applyClef(clefElement, sign, line) {
  let signEl = [...clefElement.children].find((child) => child.localName === "sign");
  if (!signEl) {
    signEl = clefElement.ownerDocument.createElement("sign");
    clefElement.appendChild(signEl);
  }
  signEl.textContent = sign;

  let lineEl = [...clefElement.children].find((child) => child.localName === "line");
  if (!lineEl) {
    lineEl = clefElement.ownerDocument.createElement("line");
    clefElement.appendChild(lineEl);
  }
  lineEl.textContent = line;

  const octaveEl = [...clefElement.children].find((child) => child.localName === "clef-octave-change");
  if (octaveEl) octaveEl.remove();
}

function getMetadata(document, filename) {
  const title = textAt(document, "work-title") || textAt(document, "movement-title") || filename.replace(/\.[^.]+$/, "");
  const part = document.querySelector("part");
  const measures = part ? [...part.children].filter((element) => element.localName === "measure").length : 0;
  const beats = textAt(document, "attributes time beats");
  const beatType = textAt(document, "attributes time beat-type");
  return { title, measureCount: measures, timeSignature: beats && beatType ? `${beats}/${beatType}` : "4/4" };
}

function textAt(root, selector) {
  return root.querySelector(selector)?.textContent?.trim() || "";
}

async function scoreId(xml, name) {
  const data = new TextEncoder().encode(xml);
  if (crypto?.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${name}-${data.length}`;
}

async function readMxl(buffer) {
  const entries = await readZipEntries(buffer);
  const container = entries.get("META-INF/container.xml");
  let rootPath = "";
  if (container) {
    const containerText = decodeXmlBytes(await unpackEntry(buffer, container));
    const document = new DOMParser().parseFromString(containerText, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("This compressed score is malformed.");
    rootPath = document.querySelector("rootfile")?.getAttribute("full-path") || "";
  }
  const scoreEntry = entries.get(rootPath) || [...entries.values()].find((entry) => entry.name.endsWith(".xml") && !entry.name.startsWith("META-INF/"));
  if (!scoreEntry) throw new Error("This compressed MusicXML file has no score XML.");
  return decodeXmlBytes(await unpackEntry(buffer, scoreEntry));
}

async function readZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const end = findEndOfCentralDirectory(view, bytes.length);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  const utf8 = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("This compressed score is malformed.");
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = utf8.decode(bytes.slice(offset + 46, offset + 46 + filenameLength));
    if (flags & 1) throw new Error("Encrypted compressed scores are not supported.");
    entries.set(name, { name, compression, compressedSize, localOffset });
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(view, length) {
  const minimum = Math.max(0, length - 65557);
  for (let offset = length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("This compressed score is malformed.");
}

async function unpackEntry(buffer, entry) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) throw new Error("This compressed score is malformed.");
  const filenameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + filenameLength + extraLength;
  const packed = bytes.slice(start, start + entry.compressedSize);
  if (entry.compression === 0) return packed;
  if (entry.compression === 8 && "DecompressionStream" in window) {
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error("This compressed score uses an unsupported compression method.");
}
