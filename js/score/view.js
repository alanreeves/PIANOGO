import { parseXml } from "./loader.js";

export class ScoreView {
  constructor({ host, viewport, stage, playhead, emptyState }) {
    this.host = host;
    this.viewport = viewport;
    this.stage = stage;
    this.playhead = playhead;
    this.emptyState = emptyState;
    this.zoom = 1;
    this.measureCount = 0;
    this.visibleStart = 1;
    this.visibleEnd = 0;
    this.lastCenteredMeasure = 0;
    this.pointers = new Map();
    this.gesture = null;
    this.osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(host, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      drawSubtitle: false,
      drawComposer: true,
      pageFormat: "Endless",
      drawingParameters: "default",
    });
    this.#attachZoomGestures();
  }

  async load(xml, measureCount, preserveZoom = false) {
    this.measureCount = measureCount;
    if (!preserveZoom) {
      this.visibleStart = 1;
      this.visibleEnd = measureCount;
      this.zoom = 1;
    }
    this.host.innerHTML = "";
    this.host.style.cssText = "";
    this.host.style.transform = "";

    const cleanXml = typeof xml === "string" ? xml.replace(/^\uFEFF/, "").trim() : xml;
    const document = typeof cleanXml === "string" ? parseXml(cleanXml) : cleanXml;

    try {
      await this.osmd.load(document);
    } catch {
      await this.osmd.load(cleanXml);
    }
    this.osmd.zoom = this.zoom;
    this.osmd.render();
    this.emptyState.hidden = true;
    this.playhead.hidden = true;
    this.lastCenteredMeasure = 0;
  }

  showRange(startBar, endBar) {
    this.visibleStart = startBar;
    this.visibleEnd = endBar;
    this.osmd.setOptions({
      drawFromMeasureNumber: startBar,
      drawUpToMeasureNumber: endBar,
      drawTitle: false,
      drawComposer: false,
    });
    this.osmd.render();
    this.clearPlayhead();
    this.lastCenteredMeasure = 0;
  }

  showFullScore() {
    this.visibleStart = 1;
    this.visibleEnd = this.measureCount;
    this.osmd.setOptions({
      drawFromMeasureNumber: 1,
      drawUpToMeasureNumber: this.measureCount,
      drawTitle: true,
      drawComposer: true,
    });
    this.osmd.render();
    this.clearPlayhead();
    this.lastCenteredMeasure = 0;
  }

  zoomBy(amount) {
    this.setZoom(this.zoom + amount);
  }

  setZoom(value) {
    this.zoom = Math.min(3, Math.max(0.55, Number(value.toFixed(2))));
    this.osmd.zoom = this.zoom;
    this.host.style.transform = "";
    this.osmd.render();
    this.clearPlayhead();
    this.lastCenteredMeasure = 0;
  }

  clearPlayhead() {
    this.playhead.hidden = true;
  }

  setPlayhead(quarter, range) {
    if (!range.measures.length) return;
    const absoluteQuarter = range.measures[0].start + quarter;
    const measure = range.measures.find((candidate) => absoluteQuarter < candidate.end) || range.measures.at(-1);
    const progress = Math.max(0, Math.min(1, (absoluteQuarter - measure.start) / measure.duration));
    const geometry = this.#measureGeometry(absoluteQuarter, measure.number, progress);
    if (!geometry) return;
    this.playhead.hidden = false;
    this.playhead.style.height = `${geometry.height}px`;
    this.playhead.style.transform = `translate(${geometry.x}px, ${geometry.y}px)`;
    if (measure.number !== this.lastCenteredMeasure) {
      this.lastCenteredMeasure = measure.number;
      this.#centerMeasure(geometry);
    }
  }

  #measureGeometry(absoluteQuarter, measureNumber, progress) {
    const scale = 10 * this.zoom;
    const hostLeft = this.host.offsetLeft;
    const hostTop = this.host.offsetTop;

    if (this.osmd?.GraphicSheet?.calculateCursorLineAtTimestamp) {
      const FractionClass = this.osmd.Sheet?.SourceMeasures?.[0]?.AbsoluteTimestamp?.constructor
        || window.opensheetmusicdisplay?.Fraction;
      const absoluteWhole = absoluteQuarter / 4.0;
      const fraction = FractionClass?.createFromFloat
        ? FractionClass.createFromFloat(absoluteWhole)
        : FractionClass
          ? new FractionClass(Math.round(absoluteWhole * 960), 960)
          : { RealValue: absoluteWhole };

      const line = this.osmd.GraphicSheet.calculateCursorLineAtTimestamp(fraction);
      if (line?.Start && line?.End && Number.isFinite(line.Start.x) && Number.isFinite(line.Start.y)) {
        const height = Math.max(line.End.y - line.Start.y, 4);
        return {
          x: hostLeft + (line.Start.x * scale) - 1.5,
          y: hostTop + (line.Start.y * scale),
          height: Math.max(30, height * scale),
        };
      }
    }

    const measureIndex = measureNumber - 1;
    const graphicalMeasures = this.osmd?.GraphicSheet?.findGraphicalMeasuresForMeasureIndex?.(measureIndex)
      || this.osmd?.GraphicSheet?.MeasureList?.[measureIndex]
      || this.osmd?.GraphicSheet?.MeasureList?.[measureNumber - this.visibleStart];

    if (Array.isArray(graphicalMeasures) && graphicalMeasures.length > 0) {
      const firstMeasure = graphicalMeasures[0];
      const system = firstMeasure?.ParentMusicSystem;
      const staffLines = system?.StaffLines || [];
      const systemY = system?.PositionAndShape?.AbsolutePosition?.y ?? firstMeasure?.PositionAndShape?.AbsolutePosition?.y;

      if (Number.isFinite(systemY)) {
        const topY = systemY + (staffLines[0]?.PositionAndShape?.RelativePosition?.y ?? 0);
        const lastLine = staffLines[staffLines.length - 1];
        const bottomY = systemY + (lastLine?.PositionAndShape?.RelativePosition?.y ?? 0) + (lastLine?.StaffHeight ?? 4);
        const height = Math.max(bottomY - topY, 4);
        const measureX = firstMeasure.PositionAndShape.AbsolutePosition.x;
        const measureWidth = firstMeasure.PositionAndShape.Size.width;
        const x = measureX + measureWidth * progress;

        return {
          x: hostLeft + (x * scale) - 1.5,
          y: hostTop + (topY * scale),
          height: Math.max(30, height * scale),
        };
      }
    }

    const visibleCount = Math.max(this.visibleEnd - this.visibleStart + 1, 1);
    const fallbackWidth = Math.max(120, this.host.clientWidth - 60);
    const fallbackHeight = Math.max(60, this.host.scrollHeight / visibleCount - 12);
    const fallbackY = ((measureNumber - this.visibleStart) / visibleCount) * this.host.scrollHeight;
    return {
      x: hostLeft + 20 + fallbackWidth * (0.04 + progress * 0.92),
      y: hostTop + fallbackY,
      height: fallbackHeight,
    };
  }

  #centerMeasure(geometry) {
    const target = geometry.y + geometry.height / 2 - this.viewport.clientHeight / 2;
    if (Math.abs(target - this.viewport.scrollTop) > this.viewport.clientHeight * 0.16) {
      this.viewport.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  }

  #attachZoomGestures() {
    this.viewport.addEventListener("pointerdown", (event) => {
      this.pointers.set(event.pointerId, event);
      this.viewport.setPointerCapture?.(event.pointerId);
      if (this.pointers.size === 2) this.#beginGesture();
    });
    this.viewport.addEventListener("pointermove", (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, event);
      if (this.pointers.size === 2 && this.gesture) {
        event.preventDefault();
        const distance = this.#pointerDistance();
        const nextZoom = Math.min(3, Math.max(0.55, this.gesture.zoom * (distance / this.gesture.distance)));
        this.host.style.transform = `scale(${nextZoom / this.zoom})`;
        this.gesture.nextZoom = nextZoom;
      }
    }, { passive: false });
    const endGesture = (event) => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2 && this.gesture) {
        const nextZoom = this.gesture.nextZoom;
        this.gesture = null;
        this.setZoom(nextZoom);
      }
    };
    this.viewport.addEventListener("pointerup", endGesture);
    this.viewport.addEventListener("pointercancel", endGesture);
  }

  #beginGesture() {
    this.gesture = { distance: this.#pointerDistance(), zoom: this.zoom, nextZoom: this.zoom };
  }

  #pointerDistance() {
    const [first, second] = [...this.pointers.values()];
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) || 1;
  }
}
