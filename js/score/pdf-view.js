export class PdfView {
  constructor({ host, viewport, stage, playhead }) {
    this.host = host;
    this.viewport = viewport;
    this.stage = stage;
    this.playhead = playhead;
    this.pdfDoc = null;
    this.canvas = null;
    this.calibrationLayer = null;
    this.zoom = 1;
    this.calibration = { bars: [], timeSignature: "4/4" };
    this.isCalibrating = false;
    this.currentSystem = null;
    this.lastClickX = null;
    this.scale = 2.0; // Render scale for crispness
    this.onCalibrationChange = () => {};
  }

  async loadPdf(bytes, calibration = null) {
    if (!window.pdfjsLib) throw new Error("PDF renderer is not loaded.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";

    const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
    this.pdfDoc = await loadingTask.promise;
    this.calibration = calibration || { bars: [], timeSignature: "4/4" };
    await this.renderPage(1);
  }

  async renderPage(pageNumber = 1) {
    const page = await this.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: this.scale });

    this.host.innerHTML = "";
    this.host.style.position = "relative";
    this.host.style.display = "inline-block";

    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(viewport.width);
    this.canvas.height = Math.round(viewport.height);
    this.canvas.style.width = `${Math.round(viewport.width / this.scale)}px`;
    this.canvas.style.height = `${Math.round(viewport.height / this.scale)}px`;
    this.canvas.style.display = "block";
    this.canvas.style.background = "#fffdf8";
    this.canvas.style.boxShadow = "0 8px 25px rgba(20, 40, 40, .12)";

    const ctx = this.canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    this.calibrationLayer = document.createElement("div");
    this.calibrationLayer.className = "pdf-calibration-layer";
    this.calibrationLayer.style.position = "absolute";
    this.calibrationLayer.style.inset = "0";
    this.calibrationLayer.style.pointerEvents = this.isCalibrating ? "auto" : "none";

    this.host.appendChild(this.canvas);
    this.host.appendChild(this.calibrationLayer);

    this.#attachClickHandlers();
    this.renderBarOverlays();
    this.applyZoom();
  }

  startCalibration(onUpdate = () => {}) {
    this.isCalibrating = true;
    this.currentSystem = null;
    this.lastClickX = null;
    this.onCalibrationChange = onUpdate;
    if (this.calibrationLayer) {
      this.calibrationLayer.style.pointerEvents = "auto";
      this.calibrationLayer.style.cursor = "crosshair";
    }
    this.renderBarOverlays();
  }

  finishCalibration() {
    this.isCalibrating = false;
    this.currentSystem = null;
    this.lastClickX = null;
    if (this.calibrationLayer) {
      this.calibrationLayer.style.pointerEvents = "none";
      this.calibrationLayer.style.cursor = "default";
    }
    this.renderBarOverlays();
    return this.calibration;
  }

  undoBar() {
    if (!this.calibration.bars.length) return;
    this.calibration.bars.pop();
    const lastBar = this.calibration.bars.at(-1);
    if (lastBar) {
      this.lastClickX = lastBar.x2;
      this.currentSystem = { top: lastBar.y1, bottom: lastBar.y2, index: lastBar.systemIndex };
    } else {
      this.lastClickX = null;
      this.currentSystem = null;
    }
    this.renderBarOverlays();
    this.onCalibrationChange(this.calibration);
  }

  clearBars() {
    this.calibration.bars = [];
    this.currentSystem = null;
    this.lastClickX = null;
    this.renderBarOverlays();
    this.onCalibrationChange(this.calibration);
  }

  #attachClickHandlers() {
    this.calibrationLayer.addEventListener("click", (event) => {
      if (!this.isCalibrating) return;
      const rect = this.canvas.getBoundingClientRect();
      const clickX = (event.clientX - rect.left) / this.zoom;
      const clickY = (event.clientY - rect.top) / this.zoom;

      this.#handleCalibrationClick(clickX, clickY);
    });
  }

  #handleCalibrationClick(x, y) {
    const defaultStaffHeight = 70; // typical staff system pixel height
    const systemYThreshold = 45; // If clicked vertically far from current line, new system

    // If starting fresh or user clicked on a new staff line below
    if (!this.currentSystem || Math.abs(y - (this.currentSystem.top + this.currentSystem.bottom) / 2) > systemYThreshold) {
      // Start of a new system
      const systemIndex = (this.calibration.bars.at(-1)?.systemIndex ?? -1) + 1;
      this.currentSystem = {
        top: Math.max(0, y - defaultStaffHeight / 2),
        bottom: y + defaultStaffHeight / 2,
        index: systemIndex,
      };
      this.lastClickX = x;
      this.renderBarOverlays(x, y);
      return;
    }

    // Subsequent click on same system: creates a bar from lastClickX to current x
    if (x <= this.lastClickX + 15) return; // Prevent accidental duplicate tiny clicks

    const barNumber = this.calibration.bars.length + 1;
    this.calibration.bars.push({
      barNumber,
      page: 1,
      systemIndex: this.currentSystem.index,
      x1: Math.round(this.lastClickX),
      x2: Math.round(x),
      y1: Math.round(this.currentSystem.top),
      y2: Math.round(this.currentSystem.bottom),
    });

    this.lastClickX = x;
    this.renderBarOverlays();
    this.onCalibrationChange(this.calibration);
  }

  renderBarOverlays(activeStartLineX = null, activeStartLineY = null) {
    if (!this.calibrationLayer) return;
    this.calibrationLayer.innerHTML = "";

    this.calibration.bars.forEach((bar) => {
      const barEl = document.createElement("div");
      barEl.className = "pdf-bar-overlay";
      barEl.style.position = "absolute";
      barEl.style.left = `${bar.x1}px`;
      barEl.style.top = `${bar.y1}px`;
      barEl.style.width = `${bar.x2 - bar.x1}px`;
      barEl.style.height = `${bar.y2 - bar.y1}px`;
      barEl.style.border = "1px dashed rgba(16, 118, 110, .4)";
      barEl.style.borderRight = "2px solid #10766e";
      barEl.style.background = "rgba(16, 118, 110, .05)";
      barEl.style.pointerEvents = "none";

      const badge = document.createElement("span");
      badge.className = "pdf-bar-badge";
      badge.textContent = bar.barNumber;
      badge.style.position = "absolute";
      badge.style.top = "-8px";
      badge.style.left = "4px";
      badge.style.background = "#0e625d";
      badge.style.color = "#fff";
      badge.style.fontSize = "10px";
      badge.style.fontWeight = "800";
      badge.style.padding = "1px 5px";
      badge.style.borderRadius = "4px";
      badge.style.boxShadow = "0 1px 3px rgba(0,0,0,.2)";

      barEl.appendChild(badge);
      this.calibrationLayer.appendChild(barEl);
    });

    // If waiting for next barline in current system, show system start line
    if (this.isCalibrating && this.lastClickX !== null && this.currentSystem) {
      const activeLine = document.createElement("div");
      activeLine.className = "pdf-active-barline";
      activeLine.style.position = "absolute";
      activeLine.style.left = `${this.lastClickX}px`;
      activeLine.style.top = `${this.currentSystem.top}px`;
      activeLine.style.width = "2px";
      activeLine.style.height = `${this.currentSystem.bottom - this.currentSystem.top}px`;
      activeLine.style.background = "#e85436";
      activeLine.style.boxShadow = "0 0 8px rgba(232, 84, 54, .8)";
      activeLine.style.pointerEvents = "none";
      this.calibrationLayer.appendChild(activeLine);
    }
  }

  showRange(startBar, endBar) {
    if (!this.calibrationLayer) return;
    const overlays = this.calibrationLayer.querySelectorAll(".pdf-bar-overlay");
    overlays.forEach((el, index) => {
      const barNum = index + 1;
      const inRange = barNum >= startBar && barNum <= endBar;
      el.style.background = inRange ? "rgba(232, 84, 54, .12)" : "rgba(16, 118, 110, .05)";
      el.style.borderColor = inRange ? "#e85436" : "rgba(16, 118, 110, .4)";
    });

    // Scroll first bar into view if outside
    const firstBar = this.calibration.bars.find((b) => b.barNumber === startBar);
    if (firstBar && this.viewport) {
      const targetY = firstBar.y1 * this.zoom - 40;
      this.viewport.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
    }
  }

  setPlayhead(quarter, range) {
    if (!this.calibration.bars.length || !this.playhead) return;
    const currentMeasure = range.measures.find((m) => quarter >= m.start && quarter < m.end) || range.measures.at(-1);
    if (!currentMeasure) return;

    const barGeom = this.calibration.bars.find((b) => b.barNumber === currentMeasure.number);
    if (!barGeom) return;

    const progress = Math.max(0, Math.min(1, (quarter - currentMeasure.start) / currentMeasure.duration));
    const currentX = (barGeom.x1 + progress * (barGeom.x2 - barGeom.x1)) * this.zoom;
    const currentY = barGeom.y1 * this.zoom;
    const height = (barGeom.y2 - barGeom.y1) * this.zoom;

    this.playhead.hidden = false;
    this.playhead.style.display = "block";
    this.playhead.style.transform = `translate3d(${Math.round(currentX)}px, ${Math.round(currentY)}px, 0)`;
    this.playhead.style.height = `${Math.round(height)}px`;
  }

  clearPlayhead() {
    if (!this.playhead) return;
    this.playhead.hidden = true;
    this.playhead.style.display = "none";
  }

  zoomBy(delta) {
    this.zoom = Math.max(0.4, Math.min(2.5, this.zoom + delta));
    this.applyZoom();
  }

  applyZoom() {
    if (!this.canvas) return;
    const baseW = Math.round(this.canvas.width / this.scale);
    const baseH = Math.round(this.canvas.height / this.scale);
    this.host.style.width = `${Math.round(baseW * this.zoom)}px`;
    this.host.style.height = `${Math.round(baseH * this.zoom)}px`;
    this.host.style.transformOrigin = "top left";
    this.canvas.style.width = `${Math.round(baseW * this.zoom)}px`;
    this.canvas.style.height = `${Math.round(baseH * this.zoom)}px`;

    if (this.calibrationLayer) {
      this.calibrationLayer.style.transform = `scale(${this.zoom})`;
      this.calibrationLayer.style.transformOrigin = "top left";
      this.calibrationLayer.style.width = `${baseW}px`;
      this.calibrationLayer.style.height = `${baseH}px`;
    }
  }

  getCropDataUrl(startBar, endBar) {
    if (!this.canvas || !this.calibration.bars.length) return null;
    const selectedBars = this.calibration.bars.filter((b) => b.barNumber >= startBar && b.barNumber <= endBar);
    if (!selectedBars.length) return null;

    const minX = Math.min(...selectedBars.map((b) => b.x1));
    const maxX = Math.max(...selectedBars.map((b) => b.x2));
    const minY = Math.min(...selectedBars.map((b) => b.y1));
    const maxY = Math.max(...selectedBars.map((b) => b.y2));

    // Pad slightly
    const pad = 10;
    const cropX = Math.max(0, Math.round((minX - pad) * this.scale));
    const cropY = Math.max(0, Math.round((minY - pad) * this.scale));
    const cropW = Math.min(this.canvas.width - cropX, Math.round((maxX - minX + pad * 2) * this.scale));
    const cropH = Math.min(this.canvas.height - cropY, Math.round((maxY - minY + pad * 2) * this.scale));

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    cropCtx.drawImage(this.canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return cropCanvas.toDataURL("image/jpeg", 0.92);
  }
}
