export class PracticeRunner {
  constructor(audio, callbacks) {
    this.audio = audio;
    this.callbacks = callbacks;
    this.running = false;
    this.timeout = 0;
    this.frame = 0;
  }

  async start(plan) {
    if (this.running) return;
    this.plan = plan;
    await this.audio.unlock({ pianoSound: plan.pianoSound });
    this.running = true;
    this.repetition = 1;
    this.tempo = plan.startTempo;
    this.startedAt = Date.now();
    this.#runCycle();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timeout);
    cancelAnimationFrame(this.frame);
    this.audio.stop();
    this.callbacks.onStop?.();
  }

  #runCycle() {
    if (!this.running) return;
    const cycle = this.audio.playCycle({ ...this.plan.range, bpm: this.tempo, ...this.plan });
    this.callbacks.onCycleStart?.({ repetition: this.repetition, repetitions: this.plan.repetitions, tempo: this.tempo, cycle });
    this.#animate(cycle);
    const wait = Math.max(0, (cycle.endAt - this.audio.now) * 1000 + 30);
    this.timeout = window.setTimeout(() => {
      if (!this.running) return;
      if (this.repetition >= this.plan.repetitions) {
        this.running = false;
        cancelAnimationFrame(this.frame);
        this.callbacks.onComplete?.({
          repetitions: this.plan.repetitions,
          finalTempo: this.tempo,
          seconds: Math.max(0, Math.round((Date.now() - this.startedAt) / 1000)),
        });
        return;
      }
      this.repetition += 1;
      this.tempo += this.plan.tempoIncrement;
      this.#runCycle();
    }, wait);
  }

  #animate(cycle) {
    const update = () => {
      if (!this.running) return;
      const quarter = Math.max(0, Math.min(this.plan.range.duration, (this.audio.now - cycle.scoreStart) / cycle.secondsPerQuarter));
      this.callbacks.onCursor?.(quarter, this.plan.range);
      this.frame = requestAnimationFrame(update);
    };
    cancelAnimationFrame(this.frame);
    update();
  }
}
