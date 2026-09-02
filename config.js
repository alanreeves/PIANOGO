export const APP_VERSION = "0.3.3";

export const DEFAULT_OMR_PROMPT = `You are an expert Optical Music Recognition (OMR) system and MusicXML transcriber.
Analyze the provided sheet music image and generate a valid, complete, and syntactically correct MusicXML (version 3.1 partwise) score.

### STRICT REQUIREMENTS:
1. Score Type: Generate a \`score-partwise\` document for a two-staff Piano part (Treble clef = Staff 1, Bass clef = Staff 2).
2. Document Structure:
   - Include \`<work><work-title>\` (extract title from score or use "Piano Piece").
   - Include \`<part-list>\` with a single \`<score-part id="P1"><part-name>Piano</part-name></score-part>\`.
3. Attributes (Measure 1):
   - \`<divisions>\`: Set an appropriate common divisor (e.g. 4 or 8 or 16).
   - \`<key>\`: Set fifths matching the key signature in the image.
   - \`<time>\`: Accurately set \`<beats>\` and \`<beat-type>\`.
   - \`<staves>2</staves>\`
   - \`<clef number="1"><sign>G</sign><line>2</line></clef>\`
   - \`<clef number="2"><sign>F</sign><line>4</line></clef>\`
4. Multi-Staff & Multi-Voice Rules:
   - When transcribing a measure, write Staff 1 (Right Hand, voice 1).
   - Use \`<backup><duration>MEASURE_TOTAL_DURATION</duration></backup>\` before writing Staff 2 (Left Hand, voice 2, staff 2).
   - If a staff contains chords, use \`<chord/>\` for subsequent notes on the same onset.
   - For rests, use \`<rest/>\` with \`<duration>\` and \`<type>\`.
5. Strict Mathematical Rhythm Balance:
   - The sum of durations for every voice in each measure MUST EXACTLY equal the measure's time signature duration.
   - Do not hallucinate notes. Transcribe exact pitches, octaves, accidentals, and rests.
6. Output Format:
   - Output ONLY the raw XML code starting with \`<?xml version="1.0" encoding="UTF-8"?>\` inside a \`\`\`xml code block.
   - Do NOT include conversational text, notes, or explanations.`;

export const DEFAULT_SETTINGS = Object.freeze({
  startTempo: 60,
  tempoIncrement: 2,
  repetitions: 8,
  hands: "both",
  countInSignature: "auto",
  pianoSound: true,
  upperClef: "auto",
  lowerClef: "auto",
  openaiApiKey: "",
  openaiModel: "GPT-5.6 Luna",
  openaiBaseUrl: "https://api.openai.com/v1",
  omrPrompt: DEFAULT_OMR_PROMPT,
});
