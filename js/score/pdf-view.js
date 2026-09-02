export class PdfView {
  constructor({ host, viewport, stage, playhead }) {
    this.host = host;
    this.viewport = viewport;
    this.stage = stage;
    this.playhead = playhead;
    this.pdfDoc = null;
    this.pageViews = [];
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

    const dataCopy = bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(dataCopy) });
    this.pdfDoc = await loadingTask.promise;
    this.calibration = calibration || { bars: [], timeSignature: "4/4" };
    await this.renderAllPages();
  }

  async renderAllPages() {
    this.host.innerHTML = "";
    this.host.style.position = "relative";
    this.host.style.display = "flex";
    this.host.style.flexDirection = "column";
    this.host.style.alignItems = "center";
    this.host.style.gap = "20px";
    this.pageViews = [];

    const numPages = this.pdfDoc.numPages || 1;
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.scale });

      const pageContainer = document.createElement("div");
      pageContainer.className = "pdf-page-container";
      pageContainer.dataset.page = String(pageNum);
      pageContainer.style.position = "relative";
      pageContainer.style.display = "inline-block";

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const baseW = Math.round(viewport.width / this.scale);
      const baseH = Math.round(viewport.height / this.scale);
      canvas.style.width = `${baseW}px`;
      canvas.style.height = `${baseH}px`;
      canvas.style.display = "block";
      canvas.style.background = "#fffdf8";
      canvas.style.boxShadow = "0 8px 25px rgba(20, 40, 40, .12)";

      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const calibrationLayer = document.createElement("div");
      calibrationLayer.className = "pdf-calibration-layer";
      calibrationLayer.dataset.page = String(pageNum);
      calibrationLayer.style.position = "absolute";
      calibrationLayer.style.inset = "0";
      calibrationLayer.style.pointerEvents = this.isCalibrating ? "auto" : "none";

      pageContainer.appendChild(canvas);
      pageContainer.appendChild(calibrationLayer);
      this.host.appendChild(pageContainer);

      const pageView = {
        pageNum,
        container: pageContainer,
        canvas,
        calibrationLayer,
        baseW,
        baseH,
      };
      this.pageViews.push(pageView);
      this.#attachPageClickHandler(pageView);
    }

    this.renderBarOverlays();
    this.applyZoom();
  }

  startCalibration(onUpdate = () => {}) {
    this.isCalibrating = true;
    this.currentSystem = null;
    this.lastClickX = null;
    this.onCalibrationChange = onUpdate;
    this.pageViews.forEach(({ calibrationLayer }) => {
      if (calibrationLayer) {
        calibrationLayer.style.pointerEvents = "auto";
        calibrationLayer.style.cursor = "crosshair";
      }
    });
    this.renderBarOverlays();
  }

  finishCalibration() {
    this.isCalibrating = false;
    this.currentSystem = null;
    this.lastClickX = null;
    this.pageViews.forEach(({ calibrationLayer }) => {
      if (calibrationLayer) {
        calibrationLayer.style.pointerEvents = "none";
        calibrationLayer.style.cursor = "default";
      }
    });
    this.renderBarOverlays();
    return this.calibration;
  }

  undoBar() {
    if (!this.calibration.bars.length) return;
    this.calibration.bars.pop();
    const lastBar = this.calibration.bars.at(-1);
    if (lastBar) {
      this.lastClickX = lastBar.x2;
      this.currentSystem = { page: lastBar.page || 1, top: lastBar.y1, bottom: lastBar.y2, index: lastBar.systemIndex };
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

  #attachPageClickHandler(pageView) {
    pageView.calibrationLayer.addEventListener("click", (event) => {
      if (!this.isCalibrating) return;
      const rect = pageView.canvas.getBoundingClientRect();
      const clickX = (event.clientX - rect.left) / this.zoom;
      const clickY = (event.clientY - rect.top) / this.zoom;

      this.#handleCalibrationClick(pageView.pageNum, clickX, clickY);
    });
  }

  #handleCalibrationClick(pageNum, x, y) {
    const defaultStaffHeight = 70; // typical staff system pixel height
    const systemYThreshold = 45; // If clicked vertically far or different page, new system

    // If starting fresh or user clicked on a different page or different staff line
    if (
      !this.currentSystem ||
      this.currentSystem.page !== pageNum ||
      Math.abs(y - (this.currentSystem.top + this.currentSystem.bottom) / 2) > systemYThreshold
    ) {
      const systemIndex = (this.calibration.bars.at(-1)?.systemIndex ?? -1) + 1;
      this.currentSystem = {
        page: pageNum,
        top: Math.max(0, y - defaultStaffHeight / 2),
        bottom: y + defaultStaffHeight / 2,
        index: systemIndex,
      };
      this.lastClickX = x;
      this.renderBarOverlays(x, y, pageNum);
      return;
    }

    // Subsequent click on same system: creates a bar from lastClickX to current x
    if (x <= this.lastClickX + 15) return; // Prevent accidental duplicate tiny clicks

    const barNumber = this.calibration.bars.length + 1;
    this.calibration.bars.push({
      barNumber,
      page: pageNum,
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

  renderBarOverlays(activeStartLineX = null, activeStartLineY = null, activePage = null) {
    this.pageViews.forEach(({ calibrationLayer }) => {
      if (calibrationLayer) calibrationLayer.innerHTML = "";
    });

    this.calibration.bars.forEach((bar) => {
      const pageNum = bar.page || 1;
      const pageView = this.pageViews.find((pv) => pv.pageNum === pageNum) || this.pageViews[0];
      if (!pageView || !pageView.calibrationLayer) return;

      const barEl = document.createElement("div");
      barEl.className = "pdf-bar-overlay";
      barEl.dataset.bar = String(bar.barNumber);
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
      pageView.calibrationLayer.appendChild(barEl);
    });

    // If waiting for next barline in current system, show active line on that page
    if (this.isCalibrating && this.lastClickX !== null && this.currentSystem) {
      const activePageView = this.pageViews.find((pv) => pv.pageNum === this.currentSystem.page) || this.pageViews[0];
      if (activePageView?.calibrationLayer) {
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
        activePageView.calibrationLayer.appendChild(activeLine);
      }
    }
  }

  showRange(startBar, endBar) {
    this.pageViews.forEach(({ calibrationLayer }) => {
      if (!calibrationLayer) return;
      const overlays = calibrationLayer.querySelectorAll(".pdf-bar-overlay");
      overlays.forEach((el) => {
        const barNum = Number(el.dataset.bar);
        const inRange = barNum >= startBar && barNum <= endBar;
        el.style.background = inRange ? "rgba(232, 84, 54, .12)" : "rgba(16, 118, 110, .05)";
        el.style.borderColor = inRange ? "#e85436" : "rgba(16, 118, 110, .4)";
      });
    });

    // Scroll first bar into view
    const firstBar = this.calibration.bars.find((b) => b.barNumber === startBar);
    if (firstBar && this.viewport) {
      const pageView = this.pageViews.find((pv) => pv.pageNum === (firstBar.page || 1)) || this.pageViews[0];
      const pageTop = pageView?.container?.offsetTop || 0;
      const targetY = pageTop + (firstBar.y1 * this.zoom) - 40;
      this.viewport.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
    }
  }

  setPlayhead(quarter, range) {
    if (!this.calibration.bars.length || !this.playhead) return;
    const currentMeasure = range.measures.find((m) => quarter >= m.start && quarter < m.end) || range.measures.at(-1);
    if (!currentMeasure) return;

    const barGeom = this.calibration.bars.find((b) => b.barNumber === currentMeasure.number);
    if (!barGeom) return;

    const pageView = this.pageViews.find((pv) => pv.pageNum === (barGeom.page || 1)) || this.pageViews[0];
    const pageLeft = pageView?.container?.offsetLeft || 0;
    const pageTop = pageView?.container?.offsetTop || 0;

    const progress = Math.max(0, Math.min(1, (quarter - currentMeasure.start) / currentMeasure.duration));
    const currentX = pageLeft + (barGeom.x1 + progress * (barGeom.x2 - barGeom.x1)) * this.zoom;
    const currentY = pageTop + (barGeom.y1 * this.zoom);
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
    this.pageViews.forEach((pageView) => {
      const scaledW = Math.round(pageView.baseW * this.zoom);
      const scaledH = Math.round(pageView.baseH * this.zoom);
      pageView.container.style.width = `${scaledW}px`;
      pageView.container.style.height = `${scaledH}px`;
      pageView.container.style.transformOrigin = "top left";
      pageView.canvas.style.width = `${scaledW}px`;
      pageView.canvas.style.height = `${scaledH}px`;

      if (pageView.calibrationLayer) {
        pageView.calibrationLayer.style.transform = `scale(${this.zoom})`;
        pageView.calibrationLayer.style.transformOrigin = "top left";
        pageView.calibrationLayer.style.width = `${pageView.baseW}px`;
        pageView.calibrationLayer.style.height = `${pageView.baseH}px`;
      }
    });
  }

  getCropDataUrl(startBar, endBar) {
    if (!this.pageViews.length || !this.calibration.bars.length) return null;
    const selectedBars = this.calibration.bars.filter((b) => b.barNumber >= startBar && b.barNumber <= endBar);
    if (!selectedBars.length) return null;

    // Group selected bars by page
    const pageGroups = new Map();
    selectedBars.forEach((bar) => {
      const pageNum = bar.page || 1;
      if (!pageGroups.has(pageNum)) pageGroups.set(pageNum, []);
      pageGroups.get(pageNum).push(bar);
    });

    const pageSlices = [];
    let totalHeight = 0;
    let maxWidth = 0;

    for (const [pageNum, bars] of pageGroups.entries()) {
      const pageView = this.pageViews.find((pv) => pv.pageNum === pageNum) || this.pageViews[0];
      if (!pageView) continue;

      const minX = Math.min(...bars.map((b) => b.x1));
      const maxX = Math.max(...bars.map((b) => b.x2));
      const minY = Math.min(...bars.map((b) => b.y1));
      const maxY = Math.max(...bars.map((b) => b.y2));

      const pad = 10;
      const cropX = Math.max(0, Math.round((minX - pad) * this.scale));
      const cropY = Math.max(0, Math.round((minY - pad) * this.scale));
      const cropW = Math.min(pageView.canvas.width - cropX, Math.round((maxX - minX + pad * 2) * this.scale));
      const cropH = Math.min(pageView.canvas.height - cropY, Math.round((maxY - minY + pad * 2) * this.scale));

      pageSlices.push({
        canvas: pageView.canvas,
        cropX,
        cropY,
        cropW,
        cropH,
      });

      maxWidth = Math.max(maxWidth, cropW);
      totalHeight += cropH;
    }

    if (!pageSlices.length || totalHeight === 0 || maxWidth === 0) return null;

    const resultCanvas = document.createElement("canvas");
    resultCanvas.width = maxWidth;
    resultCanvas.height = totalHeight;
    const resultCtx = resultCanvas.getContext("2d");
    resultCtx.fillStyle = "#fff";
    resultCtx.fillRect(0, 0, maxWidth, totalHeight);

    let currentY = 0;
    for (const slice of pageSlices) {
      resultCtx.drawImage(slice.canvas, slice.cropX, slice.cropY, slice.cropW, slice.cropH, 0, currentY, slice.cropW, slice.cropH);
      currentY += slice.cropH;
    }

    return resultCanvas.toDataURL("image/jpeg", 0.92);
  }
}
