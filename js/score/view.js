export class ScoreView {
  constructor({ host, viewport, stage, playhead, emptyState }) {
    this.host = host;
    this.viewport = viewport;
    this.stage = stage;
    this.playhead = playhead;
    this.emptyState = emptyState;
    this.zoom = 1;
    this.measureCount = 0;
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

  async load(xml, measureCount) {
    this.measureCount = measureCount;
    this.zoom = 1;
    this.host.style.transform = "";
    await this.osmd.load(xml);
    this.osmd.zoom = this.zoom;
    this.osmd.render();
    this.emptyState.hidden = true;
    this.playhead.hidden = true;
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
  }

  clearPlayhead() {
    this.playhead.hidden = true;
  }

  setPlayhead(event, range) {
    if (!event) return;
    const measure = range.measures.find((candidate) => candidate.number === event.measure);
    if (!measure) return;
    const progress = Math.max(0, Math.min(1, (event.onset - measure.start + range.measures[0].start) / measure.duration));
    const geometry = this.#measureGeometry(event.measure, progress);
    this.playhead.hidden = false;
    this.playhead.style.height = `${geometry.height}px`;
    this.playhead.style.transform = `translate(${geometry.x}px, ${geometry.y}px)`;
    if (event.measure !== this.lastCenteredMeasure) {
      this.lastCenteredMeasure = event.measure;
      this.#centerMeasure(geometry);
    }
  }

  #measureGeometry(measureNumber, progress) {
    const svg = this.host.querySelector("svg");
    const fallbackWidth = Math.max(120, this.host.clientWidth - 60);
    const fallbackHeight = Math.max(120, this.host.scrollHeight / Math.max(this.measureCount, 1) - 12);
    const fallbackY = ((measureNumber - 1) / Math.max(this.measureCount, 1)) * this.host.scrollHeight;
    const graphicalMeasures = this.osmd.GraphicSheet?.MeasureList?.[measureNumber - 1];
    const graphicalMeasure = Array.isArray(graphicalMeasures) ? graphicalMeasures.find((candidate) => candidate?.PositionAndShape) : null;
    const position = graphicalMeasure?.PositionAndShape?.AbsolutePosition;
    const size = graphicalMeasure?.PositionAndShape?.Size;
    const x = Number(position?.x ?? position?.X);
    const y = Number(position?.y ?? position?.Y);
    const width = Number(size?.width ?? size?.Width);
    const height = Number(size?.height ?? size?.Height);
    if (svg && [x, y, width, height].every(Number.isFinite)) {
      const viewBox = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.width ? rect.width / viewBox.width : 1;
      const scaleY = viewBox.height ? rect.height / viewBox.height : scaleX;
      return {
        x: this.host.offsetLeft + (x * 10 + width * 10 * progress) * scaleX,
        y: this.host.offsetTop + y * 10 * scaleY,
        height: Math.max(30, height * 10 * scaleY),
      };
    }
    return {
      x: this.host.offsetLeft + 20 + fallbackWidth * (0.04 + progress * 0.92),
      y: this.host.offsetTop + fallbackY,
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
