import { APP_VERSION, DEFAULT_SETTINGS } from "../config.js";
import { AudioEngine } from "./audio/engine.js";
import { readScoreFile, parseXml } from "./score/loader.js";
import { buildTimeline, parseTimeSignature, selectRange } from "./score/timing.js";
import { ScoreView } from "./score/view.js";
import { PracticeRunner } from "./session/runner.js";
import { getLatestScore, getStats, saveScore, saveSession } from "./store/db.js";
import { renderStats } from "./ui/stats.js";

const elements = {
  version: document.querySelector("#app-version"),
  file: document.querySelector("#score-file"),
  scoreName: document.querySelector("#score-name"),
  scoreStatus: document.querySelector("#score-status"),
  empty: document.querySelector("#score-empty"),
  form: document.querySelector("#practice-form"),
  startBar: document.querySelector("#start-bar"),
  endBar: document.querySelector("#end-bar"),
  startTempo: document.querySelector("#start-tempo"),
  increment: document.querySelector("#tempo-increment"),
  repetitions: document.querySelector("#repetitions"),
  hands: document.querySelector("#hands"),
  signature: document.querySelector("#count-in-signature"),
  sound: document.querySelector("#piano-sound"),
  start: document.querySelector("#start-button"),
  stop: document.querySelector("#stop-button"),
  sessionBars: document.querySelector("#session-bars"),
  sessionTempo: document.querySelector("#session-tempo"),
  sessionRepetition: document.querySelector("#session-repetition"),
  cleanDialog: document.querySelector("#clean-dialog"),
  cleanForm: document.querySelector("#clean-form"),
  cleanRuns: document.querySelector("#clean-runs"),
  cleanSummary: document.querySelector("#clean-summary"),
};

const view = new ScoreView({
  host: document.querySelector("#score"),
  viewport: document.querySelector("#score-viewport"),
  stage: document.querySelector("#score-stage"),
  playhead: document.querySelector("#score-playhead"),
  emptyState: elements.empty,
});
const audio = new AudioEngine();
let currentScore = null;
let currentTimeline = null;
let pendingSession = null;

const runner = new PracticeRunner(audio, {
  onCycleStart: ({ repetition, repetitions, tempo }) => {
    elements.sessionTempo.textContent = `${tempo} BPM`;
    elements.sessionRepetition.textContent = `Repetition ${repetition} of ${repetitions}`;
  },
  onCursor: (event, range) => view.setPlayhead(event, range),
  onStop: () => setIdleState("Practice stopped."),
  onComplete: (summary) => completeSession(summary),
});

function setStatus(message) {
  elements.scoreStatus.textContent = message;
}

function setIdleState(message = "Ready to practise.") {
  elements.start.disabled = !currentTimeline;
  elements.stop.disabled = true;
  elements.sessionTempo.textContent = "Ready";
  elements.sessionRepetition.textContent = "—";
  view.clearPlayhead();
  setStatus(message);
}

function readSettings() {
  return {
    startTempo: Number(elements.startTempo.value),
    tempoIncrement: Number(elements.increment.value),
    repetitions: Number(elements.repetitions.value),
    hands: elements.hands.value,
    countInSignature: elements.signature.value,
    pianoSound: elements.sound.checked,
  };
}

function saveSettings() {
  localStorage.setItem("pianogo-settings", JSON.stringify(readSettings()));
}

function restoreSettings() {
  const saved = JSON.parse(localStorage.getItem("pianogo-settings") || "null") || DEFAULT_SETTINGS;
  elements.startTempo.value = saved.startTempo;
  elements.increment.value = saved.tempoIncrement;
  elements.repetitions.value = saved.repetitions;
  elements.hands.value = saved.hands;
  elements.signature.value = saved.countInSignature;
  elements.sound.checked = saved.pianoSound;
}

async function loadScore(file) {
  setStatus("Reading score…");
  elements.start.disabled = true;
  await openScore(await readScoreFile(file), true);
}

async function restoreLatestScore() {
  const score = await getLatestScore();
  if (!score) return;
  setStatus("Restoring saved score…");
  elements.start.disabled = true;
  await openScore(score, false);
}

async function openScore(score, persist) {
  const document = parseXml(score.xml);
  const timeline = buildTimeline(document);
  if (!timeline.measures.length) throw new Error("This score has no playable measures.");
  await view.load(score.xml, timeline.measures.length);
  if (persist) await saveScore(score);
  currentScore = score;
  currentTimeline = timeline;
  elements.scoreName.textContent = score.title;
  elements.startBar.disabled = false;
  elements.endBar.disabled = false;
  elements.startBar.max = timeline.measures.length;
  elements.endBar.max = timeline.measures.length;
  elements.startBar.value = 1;
  elements.endBar.value = Math.min(timeline.measures.length, 4);
  elements.sessionBars.textContent = `Bars 1–${elements.endBar.value}`;
  elements.signature.value = timeline.timeSignature;
  await refreshStats();
  setIdleState(`${score.title} · ${timeline.measures.length} bars · ${timeline.timeSignature}`);
}

function rangeFromControls() {
  const startBar = Number(elements.startBar.value);
  const endBar = Number(elements.endBar.value);
  if (startBar > endBar) throw new Error("The end bar must be the same as or after the start bar.");
  return selectRange(currentTimeline, startBar, endBar);
}

async function startPractice() {
  if (!currentScore || !currentTimeline) return;
  const settings = readSettings();
  if (!Number.isInteger(settings.tempoIncrement) || settings.tempoIncrement < 1 || settings.tempoIncrement > 250) throw new Error("Tempo increase must be an integer from 1 to 250.");
  const range = rangeFromControls();
  const signature = parseTimeSignature(settings.countInSignature, currentTimeline.timeSignature);
  elements.sessionBars.textContent = `Bars ${elements.startBar.value}–${elements.endBar.value}`;
  elements.start.disabled = true;
  elements.stop.disabled = false;
  setStatus(`Preparing a ${signature.label} count-in…`);
  await runner.start({ ...settings, ...signature, range });
}

async function refreshStats() {
  if (currentScore) renderStats(await getStats(currentScore.id));
}

function completeSession(summary) {
  elements.stop.disabled = true;
  elements.sessionTempo.textContent = `${summary.finalTempo} BPM`;
  elements.sessionRepetition.textContent = `${summary.repetitions} repetitions complete`;
  elements.cleanRuns.min = "0";
  elements.cleanRuns.max = String(summary.repetitions);
  elements.cleanRuns.value = String(summary.repetitions);
  elements.cleanSummary.textContent = `You finished ${summary.repetitions} repetitions and reached ${summary.finalTempo} BPM.`;
  pendingSession = summary;
  elements.cleanDialog.showModal();
}

async function recordSession(cleanRuns) {
  if (!pendingSession || !currentScore) return;
  const range = rangeFromControls();
  const settings = readSettings();
  await saveSession({
    scoreId: currentScore.id,
    startBar: Number(elements.startBar.value),
    endBar: Number(elements.endBar.value),
    hands: settings.hands,
    repetitions: pendingSession.repetitions,
    cleanRuns,
    finalTempo: pendingSession.finalTempo,
    seconds: pendingSession.seconds,
  });
  pendingSession = null;
  await refreshStats();
  setIdleState("Progress saved. Ready for another run.");
}

function showError(error) {
  setIdleState(error instanceof Error ? error.message : "Something went wrong while preparing the score.");
}

elements.version.textContent = `v${APP_VERSION}`;
restoreSettings();
restoreLatestScore().catch(showError);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {}));
}

elements.file.addEventListener("change", async () => {
  const [file] = elements.file.files;
  if (!file) return;
  try {
    await loadScore(file);
  } catch (error) {
    showError(error);
  }
});

elements.form.addEventListener("change", saveSettings);
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  startPractice().catch(showError);
});
elements.stop.addEventListener("click", () => runner.stop());
document.querySelector("#zoom-in").addEventListener("click", () => view.zoomBy(0.15));
document.querySelector("#zoom-out").addEventListener("click", () => view.zoomBy(-0.15));

[elements.startBar, elements.endBar].forEach((input) => input.addEventListener("input", () => {
  if (!currentTimeline) return;
  elements.sessionBars.textContent = `Bars ${elements.startBar.value}–${elements.endBar.value}`;
}));

elements.cleanForm.addEventListener("submit", (event) => {
  const submitter = event.submitter;
  window.setTimeout(() => {
    const cleanRuns = submitter?.value === "save" ? Math.max(0, Math.min(Number(elements.cleanRuns.value) || 0, Number(elements.cleanRuns.max))) : 0;
    recordSession(cleanRuns).catch(showError);
  });
});
