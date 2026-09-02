import { APP_VERSION, DEFAULT_OMR_PROMPT, DEFAULT_SETTINGS } from "../config.js";
import { AudioEngine } from "./audio/engine.js";
import { readScoreFile, parseXml, transformClefs } from "./score/loader.js";
import { exportCalibrationFile, parseCalibrationJson } from "./score/pdf-calibration.js";
import { PdfView } from "./score/pdf-view.js";
import { downloadFile, transcribeSnippet } from "./score/omr.js";
import { buildPdfTimeline, buildTimeline, parseTimeSignature, selectRange } from "./score/timing.js";
import { ScoreView } from "./score/view.js";
import { PracticeRunner } from "./session/runner.js";
import { getLatestScore, getStats, saveScore, saveSession } from "./store/db.js";
import { renderStats } from "./ui/stats.js";

const elements = {
  header: document.querySelector(".app-header"),
  practicePanel: document.querySelector(".practice-panel"),
  version: document.querySelector("#app-version"),
  settingsBtn: document.querySelector("#settings-button"),
  file: document.querySelector("#score-file"),
  scoreName: document.querySelector("#score-name"),
  scoreStatus: document.querySelector("#score-status"),
  focusReadout: document.querySelector("#focus-readout"),
  focusStop: document.querySelector("#focus-stop"),
  calibrateBtn: document.querySelector("#calibrate-btn"),
  calibrationToolbar: document.querySelector("#calibration-toolbar"),
  calibHint: document.querySelector("#calib-hint"),
  calibUndoBtn: document.querySelector("#calib-undo-btn"),
  calibClearBtn: document.querySelector("#calib-clear-btn"),
  calibExportBtn: document.querySelector("#calib-export-btn"),
  calibImportBtn: document.querySelector("#calib-import-btn"),
  calibImportFile: document.querySelector("#calib-import-file"),
  calibDoneBtn: document.querySelector("#calib-done-btn"),
  transcribeRangeBtn: document.querySelector("#transcribe-range-btn"),
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
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  settingsClose: document.querySelector("#settings-close"),
  settingApiKey: document.querySelector("#setting-openai-key"),
  toggleKeyBtn: document.querySelector("#toggle-key-btn"),
  settingModel: document.querySelector("#setting-openai-model"),
  settingBaseUrl: document.querySelector("#setting-openai-base-url"),
  settingPrompt: document.querySelector("#setting-omr-prompt"),
  resetPromptBtn: document.querySelector("#reset-prompt-btn"),
  exportSettingsBtn: document.querySelector("#export-settings-btn"),
  importSettingsBtn: document.querySelector("#import-settings-btn"),
  importSettingsFile: document.querySelector("#import-settings-file"),
};

const view = new ScoreView({
  host: document.querySelector("#score"),
  viewport: document.querySelector("#score-viewport"),
  stage: document.querySelector("#score-stage"),
  playhead: document.querySelector("#score-playhead"),
  emptyState: elements.empty,
});

const pdfView = new PdfView({
  host: document.querySelector("#score"),
  viewport: document.querySelector("#score-viewport"),
  stage: document.querySelector("#score-stage"),
  playhead: document.querySelector("#score-playhead"),
});

const audio = new AudioEngine();
let currentScore = null;
let currentTimeline = null;
let activeScoreType = "xml"; // "xml" | "pdf"
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
  onCursor: (quarter, range) => {
    if (activeScoreType === "pdf") {
      pdfView.setPlayhead(quarter, range);
    } else {
      view.setPlayhead(quarter, range);
    }
  },
  onStop: () => {
    exitFocusMode();
    setIdleState("Practice stopped.");
  },
  onComplete: (summary) => completeSession(summary),
});

function setStatus(message) {
  elements.scoreStatus.textContent = message;
}

function updateFocusReadout(repetition = 0, repetitions = 0, tempo = Number(elements.startTempo.value)) {
  const progress = repetitions ? ` · Repetition ${repetition} of ${repetitions}` : "";
  elements.focusReadout.textContent = `Bars ${elements.startBar.value}–${elements.endBar.value} · ${tempo} BPM${progress}`;
}

function enterFocusMode() {
  focusActive = true;
  document.body.classList.add("focus-mode");
  elements.header.hidden = true;
  elements.practicePanel.hidden = true;
  elements.focusReadout.hidden = false;
  elements.focusStop.hidden = false;
  updateFocusReadout();
  elements.focusStop.focus();
}

function exitFocusMode() {
  if (!focusActive) return;
  focusActive = false;
  document.body.classList.remove("focus-mode");
  elements.header.hidden = false;
  elements.practicePanel.hidden = false;
  elements.focusReadout.hidden = true;
  elements.focusStop.hidden = true;
  if (activeScoreType === "xml") view.showFullScore();
}

function setIdleState(message = "Ready to practise.") {
  elements.start.disabled = !currentTimeline || (activeScoreType === "pdf" && !currentTimeline.measures.length);
  elements.stop.disabled = true;
  elements.sessionTempo.textContent = "Ready";
  elements.sessionRepetition.textContent = "—";
  if (activeScoreType === "pdf") pdfView.clearPlayhead();
  else view.clearPlayhead();
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
    openaiApiKey: elements.settingApiKey?.value?.trim() || "",
    openaiModel: elements.settingModel?.value?.trim() || "GPT-5.6 Luna",
    openaiBaseUrl: elements.settingBaseUrl?.value?.trim() || "https://api.openai.com/v1",
    omrPrompt: elements.settingPrompt?.value?.trim() || DEFAULT_OMR_PROMPT,
  };
}

function saveSettings() {
  localStorage.setItem("pianogo-settings", JSON.stringify(readSettings()));
}

function applySettingsToForm(saved) {
  elements.startTempo.value = saved.startTempo ?? DEFAULT_SETTINGS.startTempo;
  elements.increment.value = saved.tempoIncrement ?? DEFAULT_SETTINGS.tempoIncrement;
  elements.repetitions.value = saved.repetitions ?? DEFAULT_SETTINGS.repetitions;
  elements.hands.value = saved.hands ?? DEFAULT_SETTINGS.hands;
  elements.signature.value = saved.countInSignature ?? DEFAULT_SETTINGS.countInSignature;
  elements.sound.checked = saved.pianoSound ?? DEFAULT_SETTINGS.pianoSound;
  upperClef = saved.upperClef || "auto";
  lowerClef = saved.lowerClef || "auto";
  if (elements.settingApiKey) elements.settingApiKey.value = saved.openaiApiKey || "";
  if (elements.settingModel) elements.settingModel.value = saved.openaiModel || DEFAULT_SETTINGS.openaiModel;
  if (elements.settingBaseUrl) elements.settingBaseUrl.value = saved.openaiBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl;
  if (elements.settingPrompt) elements.settingPrompt.value = saved.omrPrompt || DEFAULT_OMR_PROMPT;
  updateClefButtons();
}

function restoreSettings() {
  const saved = JSON.parse(localStorage.getItem("pianogo-settings") || "null") || DEFAULT_SETTINGS;
  applySettingsToForm(saved);
}

async function setClef(type, value) {
  if (type === "upper") upperClef = value;
  if (type === "lower") lowerClef = value;
  updateClefButtons();
  saveSettings();
  if (activeScoreType !== "xml" || !currentScore || !currentTimeline) return;
  const transformedXml = transformClefs(currentScore.xml, { upper: upperClef, lower: lowerClef });
  await view.load(transformedXml, currentTimeline.measures.length, true);
  const startBar = Number(elements.startBar.value) || 1;
  const endBar = Number(elements.endBar.value) || currentTimeline.measures.length;
  view.showRange(startBar, endBar);
}

async function loadScore(file) {
  setStatus("Reading score…");
  elements.start.disabled = true;

  if (file.name.toLowerCase().endsWith(".pdf")) {
    const bytes = await file.arrayBuffer();
    const title = file.name.replace(/\.pdf$/i, "");
    const score = {
      id: `pdf-${file.name}`,
      name: file.name,
      title,
      type: "pdf",
      pdfBytes: bytes,
      calibration: { bars: [], timeSignature: elements.signature.value || "4/4" },
    };
    await openPdfScore(score, true);
    return;
  }

  await openScore(await readScoreFile(file), true);
}

async function openPdfScore(score, persist) {
  activeScoreType = "pdf";
  elements.empty.hidden = true;
  elements.calibrateBtn.hidden = false;
  elements.calibrationToolbar.hidden = true;

  await pdfView.loadPdf(score.pdfBytes, score.calibration);
  if (persist) await saveScore(score);
  currentScore = score;

  elements.scoreName.textContent = score.title;
  const barsCount = score.calibration?.bars?.length || 0;
  const numPages = pdfView.pageViews?.length || 1;
  const pageLabel = numPages === 1 ? "1 page" : `${numPages} pages`;

  if (barsCount > 0) {
    currentTimeline = buildPdfTimeline(score.calibration, elements.signature.value);
    elements.startBar.disabled = false;
    elements.endBar.disabled = false;
    elements.startBar.max = barsCount;
    elements.endBar.max = barsCount;
    elements.startBar.value = 1;
    elements.endBar.value = Math.min(barsCount, 4);
    elements.sessionBars.textContent = `Bars 1–${elements.endBar.value}`;
    if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.hidden = false;
    pdfView.showRange(1, elements.endBar.value);
    await refreshStats();
    setIdleState(`${score.title} · ${pageLabel} · ${barsCount} bars · ${currentTimeline.timeSignature}`);
  } else {
    currentTimeline = buildPdfTimeline({ bars: [] }, elements.signature.value);
    elements.startBar.disabled = true;
    elements.endBar.disabled = true;
    elements.start.disabled = true;
    if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.hidden = true;
    setStatus(`PDF loaded (${pageLabel}). Click '📐 Calibrate Bars' to mark barlines.`);
  }
}

async function restoreLatestScore() {
  const score = await getLatestScore();
  if (!score) return;
  setStatus("Restoring saved score…");
  elements.start.disabled = true;
  if (score.type === "pdf" && score.pdfBytes) {
    await openPdfScore(score, false);
  } else if (score.xml) {
    await openScore(score, false);
  }
}

async function openScore(score, persist) {
  activeScoreType = "xml";
  elements.calibrateBtn.hidden = true;
  elements.calibrationToolbar.hidden = true;
  if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.hidden = true;

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
  view.showRange(1, elements.endBar.value);
  await refreshStats();
  setIdleState(`${score.title} · ${timeline.measures.length} bars · ${timeline.timeSignature}`);
}

function startCalibrationMode() {
  if (activeScoreType !== "pdf") return;
  elements.calibrationToolbar.hidden = false;
  elements.calibrateBtn.hidden = true;
  elements.start.disabled = true;
  if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.hidden = true;
  elements.calibHint.textContent = `Click start of staff line, then click each barline (${pdfView.calibration.bars.length} bars marked)`;

  pdfView.startCalibration((updatedCalibration) => {
    elements.calibHint.textContent = `Click start of staff line, then click each barline (${updatedCalibration.bars.length} bars marked)`;
  });
}

async function finishCalibrationMode() {
  const calib = pdfView.finishCalibration();
  elements.calibrationToolbar.hidden = true;
  elements.calibrateBtn.hidden = false;

  currentScore.calibration = calib;
  await saveScore(currentScore);

  const barsCount = calib.bars.length;
  if (barsCount > 0) {
    currentTimeline = buildPdfTimeline(calib, elements.signature.value);
    elements.startBar.disabled = false;
    elements.endBar.disabled = false;
    elements.startBar.max = barsCount;
    elements.endBar.max = barsCount;
    elements.startBar.value = 1;
    elements.endBar.value = Math.min(barsCount, 4);
    elements.sessionBars.textContent = `Bars 1–${elements.endBar.value}`;
    if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.hidden = false;
    pdfView.showRange(1, elements.endBar.value);
    setIdleState(`Calibration saved! ${barsCount} bars ready to practise.`);
  } else {
    if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.hidden = true;
    setIdleState("No bars calibrated yet. Click '📐 Calibrate Bars' to mark measures.");
  }
}

function rangeFromControls() {
  const startBar = Number(elements.startBar.value);
  const endBar = Number(elements.endBar.value);
  if (startBar > endBar) throw new Error("The end bar must be the same as or after the start bar.");
  return selectRange(currentTimeline, startBar, endBar);
}

async function handleTranscribeRange() {
  if (activeScoreType !== "pdf" || !currentScore || !currentTimeline) return;
  const settings = readSettings();
  if (!settings.openaiApiKey) {
    throw new Error("Please enter your OpenAI API Key in Settings to transcribe audio for these bars.");
  }
  const startBar = Number(elements.startBar.value);
  const endBar = Number(elements.endBar.value);
  const cacheKey = `pianogo-snippet-${currentScore.id}-${startBar}-${endBar}`;
  const snippetDataUrl = pdfView.getCropDataUrl(startBar, endBar);
  if (!snippetDataUrl) throw new Error("Could not crop the selected bar range from the PDF.");

  setStatus(`AI transcribing Bars ${startBar}–${endBar}…`);
  if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.disabled = true;
  try {
    const result = await transcribeSnippet({
      snippetDataUrl,
      startBar,
      endBar,
      timeSignature: currentTimeline.timeSignature,
      settings,
      onProgress: (msg) => setStatus(msg),
    });
    const snippetTimeline = buildTimeline(result.document);
    localStorage.setItem(cacheKey, JSON.stringify(snippetTimeline.events));
    setStatus(`Bars ${startBar}–${endBar} transcribed (${snippetTimeline.events.length} notes cached)! Ready to practice.`);
  } finally {
    if (elements.transcribeRangeBtn) elements.transcribeRangeBtn.disabled = false;
  }
}

async function startPractice() {
  if (!currentScore || !currentTimeline) return;
  const settings = readSettings();
  if (!Number.isInteger(settings.tempoIncrement) || settings.tempoIncrement < 1 || settings.tempoIncrement > 250) throw new Error("Tempo increase must be an integer from 1 to 250.");
  const startBar = Number(elements.startBar.value);
  const endBar = Number(elements.endBar.value);
  let range = rangeFromControls();
  const signature = parseTimeSignature(settings.countInSignature, currentTimeline.timeSignature);
  elements.sessionBars.textContent = `Bars ${startBar}–${endBar}`;
  elements.start.disabled = true;
  elements.stop.disabled = false;

  // For PDF mode: On-demand AI snippet transcription if piano sound is enabled and API key is set
  if (activeScoreType === "pdf" && settings.pianoSound && settings.openaiApiKey) {
    const cacheKey = `pianogo-snippet-${currentScore.id}-${startBar}-${endBar}`;
    let cachedEvents = JSON.parse(localStorage.getItem(cacheKey) || "null");

    if (!cachedEvents) {
      const snippetDataUrl = pdfView.getCropDataUrl(startBar, endBar);
      if (snippetDataUrl) {
        setStatus(`AI transcribing Bars ${startBar}–${endBar} snippet…`);
        try {
          const result = await transcribeSnippet({
            snippetDataUrl,
            startBar,
            endBar,
            timeSignature: currentTimeline.timeSignature,
            settings,
            onProgress: (msg) => setStatus(msg),
          });
          const snippetTimeline = buildTimeline(result.document);
          cachedEvents = snippetTimeline.events;
          localStorage.setItem(cacheKey, JSON.stringify(cachedEvents));
        } catch (err) {
          console.warn("Snippet AI transcription failed, falling back to metronome:", err);
          setStatus(`Notice: ${err.message} (Practising with metronome)`);
        }
      }
    }

    if (cachedEvents?.length) {
      range = {
        ...range,
        events: cachedEvents.map((e) => ({ ...e, onset: e.onset % range.duration })),
      };
    }
  }

  setStatus(settings.pianoSound && !audio.pianoSamplesReady ? "Loading grand piano samples…" : `Preparing a ${signature.label} count-in…`);
  try {
    await audio.unlock({ pianoSound: settings.pianoSound });
    setStatus(`Preparing a ${signature.label} count-in…`);
    if (activeScoreType === "pdf") {
      pdfView.showRange(startBar, endBar);
    } else {
      view.showRange(startBar, endBar);
    }
    enterFocusMode();
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
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {}));
}

elements.settingsBtn.addEventListener("click", () => elements.settingsDialog.showModal());
elements.settingsClose.addEventListener("click", () => elements.settingsDialog.close());

elements.calibrateBtn?.addEventListener("click", () => startCalibrationMode());
elements.calibUndoBtn?.addEventListener("click", () => pdfView.undoBar());
elements.calibClearBtn?.addEventListener("click", () => pdfView.clearBars());
elements.calibDoneBtn?.addEventListener("click", () => finishCalibrationMode().catch(showError));

elements.calibExportBtn?.addEventListener("click", () => {
  if (pdfView.calibration) {
    exportCalibrationFile(pdfView.calibration, `${currentScore?.title || "score"}.pianogo.json`);
  }
});

elements.calibImportBtn?.addEventListener("click", () => elements.calibImportFile.click());
elements.calibImportFile?.addEventListener("change", async () => {
  const [file] = elements.calibImportFile.files;
  if (!file) return;
  try {
    const text = await file.text();
    const imported = parseCalibrationJson(text);
    pdfView.calibration = imported;
    pdfView.renderBarOverlays();
    elements.calibImportFile.value = "";
    elements.calibHint.textContent = `Imported ${imported.bars.length} bars from JSON file.`;
  } catch (err) {
    showError(new Error("Could not parse calibration JSON file."));
  }
});

elements.toggleKeyBtn?.addEventListener("click", () => {
  const isPassword = elements.settingApiKey.type === "password";
  elements.settingApiKey.type = isPassword ? "text" : "password";
  elements.toggleKeyBtn.textContent = isPassword ? "Hide" : "Show";
});

document.querySelectorAll(".chip-btn[data-model]").forEach((btn) => {
  btn.addEventListener("click", () => {
    elements.settingModel.value = btn.dataset.model;
    saveSettings();
  });
});

elements.resetPromptBtn?.addEventListener("click", () => {
  elements.settingPrompt.value = DEFAULT_OMR_PROMPT;
  saveSettings();
});

elements.exportSettingsBtn?.addEventListener("click", () => {
  const data = JSON.stringify(readSettings(), null, 2);
  downloadFile("pianogo-settings.json", data, "application/json");
});

elements.importSettingsBtn?.addEventListener("click", () => {
  elements.importSettingsFile.click();
});

elements.importSettingsFile?.addEventListener("change", async () => {
  const [file] = elements.importSettingsFile.files;
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    applySettingsToForm(imported);
    saveSettings();
    elements.importSettingsFile.value = "";
    setStatus("Settings loaded from JSON file.");
  } catch {
    showError(new Error("Could not parse the selected settings JSON file."));
  }
});

elements.settingsForm.addEventListener("submit", () => {
  saveSettings();
});

elements.transcribeRangeBtn?.addEventListener("click", () => {
  handleTranscribeRange().catch(showError);
});

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

document.querySelector("#zoom-in").addEventListener("click", () => {
  if (activeScoreType === "pdf") pdfView.zoomBy(0.15);
  else view.zoomBy(0.15);
});
document.querySelector("#zoom-out").addEventListener("click", () => {
  if (activeScoreType === "pdf") pdfView.zoomBy(-0.15);
  else view.zoomBy(-0.15);
});

document.querySelectorAll(".btn-toggle[data-clef]").forEach((btn) => {
  btn.addEventListener("click", () => {
    setClef(btn.dataset.clef, btn.dataset.value).catch(showError);
  });
});

[elements.startBar, elements.endBar].forEach((input) => input.addEventListener("input", () => {
  if (!currentTimeline) return;
  const start = Number(elements.startBar.value) || 1;
  const end = Number(elements.endBar.value) || start;
  elements.sessionBars.textContent = `Bars ${elements.startBar.value}–${elements.endBar.value}`;
  if (activeScoreType === "pdf") pdfView.showRange(start, end);
}));

elements.cleanForm.addEventListener("submit", (event) => {
  const submitter = event.submitter;
  window.setTimeout(() => {
    const cleanRuns = submitter?.value === "save" ? Math.max(0, Math.min(Number(elements.cleanRuns.value) || 0, Number(elements.cleanRuns.max))) : 0;
    recordSession(cleanRuns).catch(showError);
  });
});
