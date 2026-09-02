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
  if (entry.compression === 8) {
    try {
      if ("DecompressionStream" in window) {
        const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
    } catch {
      // Fallback for Safari / environments without deflate-raw
    }
    return inflateRaw(packed);
  }
  throw new Error("This compressed score uses an unsupported compression method.");
}

function inflateRaw(input) {
  let bitPos = 0;
  const bits = (n) => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = bitPos >> 3;
      const bitIdx = bitPos & 7;
      if (byteIdx < input.length) {
        val |= ((input[byteIdx] >> bitIdx) & 1) << i;
      }
      bitPos++;
    }
    return val;
  };

  const buildTree = (lengths) => {
    const maxLen = Math.max(...lengths, 0);
    if (maxLen === 0) return null;
    const count = new Uint16Array(maxLen + 1);
    for (const len of lengths) if (len > 0) count[len]++;
    const nextCode = new Uint16Array(maxLen + 1);
    let code = 0;
    for (let bitsLen = 1; bitsLen <= maxLen; bitsLen++) {
      code = (code + count[bitsLen - 1]) << 1;
      nextCode[bitsLen] = code;
    }
    const tree = {};
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      const len = lengths[symbol];
      if (len > 0) {
        const c = nextCode[len]++;
        let node = tree;
        for (let i = len - 1; i >= 0; i--) {
          const bit = (c >> i) & 1;
          node = node[bit] = node[bit] || {};
        }
        node.symbol = symbol;
      }
    }
    return tree;
  };

  const decodeSymbol = (tree) => {
    let node = tree;
    while (node && node.symbol === undefined) {
      const bit = bits(1);
      node = node[bit];
    }
    return node ? node.symbol : -1;
  };

  const LENGTH_CODES = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
  ];
  const LENGTH_EXTRA_BITS = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
  ];
  const DIST_CODES = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
  ];
  const DIST_EXTRA_BITS = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
  ];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  const fixedLitLengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) fixedLitLengths[i] = 8;
  for (let i = 144; i <= 255; i++) fixedLitLengths[i] = 9;
  for (let i = 256; i <= 279; i++) fixedLitLengths[i] = 7;
  for (let i = 280; i <= 287; i++) fixedLitLengths[i] = 8;
  const fixedLitTree = buildTree(fixedLitLengths);

  const fixedDistLengths = new Uint8Array(32);
  for (let i = 0; i < 32; i++) fixedDistLengths[i] = 5;
  const fixedDistTree = buildTree(fixedDistLengths);

  const output = [];
  let isFinal = 0;

  while (!isFinal) {
    isFinal = bits(1);
    const blockType = bits(2);

    if (blockType === 0) {
      bitPos = (bitPos + 7) & ~7;
      const len = input[bitPos >> 3] | (input[(bitPos >> 3) + 1] << 8);
      bitPos += 32;
      const byteStart = bitPos >> 3;
      for (let i = 0; i < len; i++) output.push(input[byteStart + i]);
      bitPos += len * 8;
    } else if (blockType === 1 || blockType === 2) {
      let litTree = fixedLitTree;
      let distTree = fixedDistTree;

      if (blockType === 2) {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;

        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[CL_ORDER[i]] = bits(3);
        const clTree = buildTree(clLengths);

        const allLengths = [];
        while (allLengths.length < hlit + hdist) {
          const sym = decodeSymbol(clTree);
          if (sym < 16) {
            allLengths.push(sym);
          } else if (sym === 16) {
            const repeat = bits(2) + 3;
            const prev = allLengths[allLengths.length - 1] || 0;
            for (let i = 0; i < repeat; i++) allLengths.push(prev);
          } else if (sym === 17) {
            const repeat = bits(3) + 3;
            for (let i = 0; i < repeat; i++) allLengths.push(0);
          } else if (sym === 18) {
            const repeat = bits(7) + 11;
            for (let i = 0; i < repeat; i++) allLengths.push(0);
          }
        }
        litTree = buildTree(allLengths.slice(0, hlit));
        distTree = buildTree(allLengths.slice(hlit, hlit + hdist));
      }

      while (true) {
        const sym = decodeSymbol(litTree);
        if (sym === 256 || sym < 0) break;
        if (sym < 256) {
          output.push(sym);
        } else {
          const lenIdx = sym - 257;
          const length = LENGTH_CODES[lenIdx] + (LENGTH_EXTRA_BITS[lenIdx] > 0 ? bits(LENGTH_EXTRA_BITS[lenIdx]) : 0);
          const distSym = decodeSymbol(distTree);
          const distance = DIST_CODES[distSym] + (DIST_EXTRA_BITS[distSym] > 0 ? bits(DIST_EXTRA_BITS[distSym]) : 0);

          for (let i = 0; i < length; i++) {
            output.push(output[output.length - distance]);
          }
        }
      }
    } else {
      throw new Error("Invalid deflate block type.");
    }
  }

  return new Uint8Array(output);
}
