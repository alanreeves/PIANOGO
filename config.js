export const APP_VERSION = "0.5.0";

export const DEFAULT_OMR_PROMPT = `You are an expert MusicXML transcriber.
Analyze the provided sheet music snippet image containing the specified bars.
Time signature: {timeSignature}.

STRICT REQUIREMENTS:
1. Generate valid, complete MusicXML 3.1 score-partwise XML for a two-staff piano part (Staff 1 = Treble, Staff 2 = Bass).
2. Exactly {numBars} measure(s) must be generated (numbered Bars {startBar} to {endBar}).
3. Keep exact rhythm, pitches, accidentals, chords, and rests.
4. Output ONLY the raw XML inside a \`\`\`xml code block.`;

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
