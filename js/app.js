import { APP_VERSION, DEFAULT_SETTINGS } from "../config.js";
import { AudioEngine } from "./audio/engine.js";
import { readScoreFile, parseXml, transformClefs } from "./score/loader.js";
import { buildTimeline, parseTimeSignature, selectRange } from "./score/timing.js";
import { ScoreView } from "./score/view.js";
import { PracticeRunner } from "./session/runner.js";
import { getLatestScore, getStats, saveScore, saveSession } from "./store/db.js";
import { renderStats } from "./ui/stats.js";

const elements = {
  header: document.querySelector(".app-header"),
  practicePanel: document.querySelector(".practice-panel"),
  version: document.querySelector("#app-version"),
  file: document.querySelector("#score-file"),
  scoreName: document.querySelector("#score-name"),
  scoreStatus: document.querySelector("#score-status"),
  focusReadout: document.querySelector("#focus-readout"),
  focusStop: document.querySelector("#focus-stop"),
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
let focusActive = false;
let upperClef = "auto";
let lowerClef = "auto";

const runner = new PracticeRunner(audio, {
  onCycleStart: ({ repetition, repetitions, tempo }) => {
    elements.sessionTempo.textContent = `${tempo} BPM`;
    elements.sessionRepetition.textContent = `Repetition ${repetition} of ${repetitions}`;
    updateFocusReadout(repetition, repetitions, tempo);
  },
  onCursor: (quarter, range) => view.setPlayhead(quarter, range),
  onStop: () => {
    exitFocusMode();
    setIdleState("Practice stopped.");
  },
  onComplete: (summary) => completeSession(summary),
});

function enterFocusMode() {
  focusActive = true;
  document.body.classList.add("focus-mode");
  elements.focusReadout.hidden = false;
  elements.focusStop.hidden = false;
  elements.practicePanel.hidden = true;
  elements.header.hidden = true;
}

function exitFocusMode() {
  if (!focusActive) return;
  focusActive = false;
  document.body.classList.remove("focus-mode");
  elements.focusReadout.hidden = true;
  elements.focusStop.hidden = true;
  elements.practicePanel.hidden = false;
  elements.header.hidden = false;
  view.showFullScore();
}

function updateFocusReadout(repetition, total, tempo) {
  elements.focusReadout.textContent = `Run ${repetition}/${total} · ${tempo} BPM`;
}

function setStatus(message) {
  elements.scoreStatus.textContent = message;
}

function setIdleState(message) {
  elements.start.disabled = !currentTimeline;
  elements.stop.disabled = true;
  elements.sessionTempo.textContent = "Ready";
  elements.sessionRepetition.textContent = "—";
  view.clearPlayhead();
  setStatus(message);
}

function updateClefButtons() {
  document.querySelectorAll("[data-clef='upper']").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === upperClef);
  });
  document.querySelectorAll("[data-clef='lower']").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === lowerClef);
  });
}

function readSettings() {
  return {
    startTempo: Number(elements.startTempo.value),
    tempoIncrement: Number(elements.increment.value),
    repetitions: Number(elements.repetitions.value),
    hands: elements.hands.value,
    countInSignature: elements.signature.value,
    pianoSound: elements.sound.checked,
    upperClef,
    lowerClef,
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
  upperClef = saved.upperClef || "auto";
  lowerClef = saved.lowerClef || "auto";
  updateClefButtons();
}

async function setClef(type, value) {
  if (type === "upper") upperClef = value;
  if (type === "lower") lowerClef = value;
  updateClefButtons();
  saveSettings();
  if (!currentScore || !currentTimeline) return;
  const transformedXml = transformClefs(currentScore.xml, { upper: upperClef, lower: lowerClef });
  await view.load(transformedXml, currentTimeline.measures.length, true);
  if (focusActive) {
    const startBar = Number(elements.startBar.value) || 1;
    const endBar = Number(elements.endBar.value) || currentTimeline.measures.length;
    view.showRange(startBar, endBar);
  } else {
    view.showFullScore();
  }
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
  const transformedXml = transformClefs(score.xml, { upper: upperClef, lower: lowerClef });
  await view.load(transformedXml, timeline.measures.length);
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
  view.showFullScore();
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
  setStatus(settings.pianoSound && !audio.pianoSamplesReady ? "Loading grand piano samples…" : `Preparing a ${signature.label} count-in…`);
  try {
    await audio.unlock({ pianoSound: settings.pianoSound });
    setStatus(`Preparing a ${signature.label} count-in…`);
    enterFocusMode();
    view.showRange(Number(elements.startBar.value), Number(elements.endBar.value));
    await runner.start({ ...settings, ...signature, range });
  } catch (error) {
    exitFocusMode();
    throw error;
  }
}

async function refreshStats() {
  if (currentScore) renderStats(await getStats(currentScore.id));
}

function completeSession(summary) {
  exitFocusMode();
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
  exitFocusMode();
  setIdleState(error instanceof Error ? error.message : "Something went wrong while preparing the score.");
}

elements.version.textContent = `v${APP_VERSION}`;
restoreSettings();
restoreLatestScore().catch(showError);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      reg.update();
    } catch {}
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
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
elements.focusStop.addEventListener("click", () => runner.stop());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && focusActive) runner.stop();
});
document.querySelector("#zoom-in").addEventListener("click", () => view.zoomBy(0.15));
document.querySelector("#zoom-out").addEventListener("click", () => view.zoomBy(-0.15));

document.querySelectorAll(".btn-toggle[data-clef]").forEach((btn) => {
  btn.addEventListener("click", () => {
    setClef(btn.dataset.clef, btn.dataset.value).catch(showError);
  });
});

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
