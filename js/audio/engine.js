import { PianoSampler } from "./piano.js";

const PARTIALS = [
  { ratio: 1, gain: 0.18, type: "sine" },
  { ratio: 2, gain: 0.08, type: "triangle" },
  { ratio: 3, gain: 0.035, type: "sine" },
];

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.piano = null;
    this.activeOscillators = new Set();
  }

  async unlock({ pianoSound = true } = {}) {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.context.destination);
      const bus = this.context.createDynamicsCompressor();
      bus.threshold.value = -10;
      bus.knee.value = 26;
      bus.ratio.value = 4;
      bus.attack.value = 0.005;
      bus.release.value = 0.2;
      bus.connect(this.master);
      this.piano = new PianoSampler(this.context, bus);
    }
    if (this.context.state !== "running") await this.context.resume();
    if (pianoSound) await this.piano.load();
  }

  get pianoSamplesReady() {
    return Boolean(this.piano?.ready);
  }

  get now() {
    return this.context?.currentTime || 0;
  }

  playCycle({ events, duration, bpm, beats, beatType, hands, pianoSound }) {
    this.stop();
    const start = this.now + 0.14;
    const secondsPerQuarter = 60 / bpm;
    const beatSeconds = secondsPerQuarter * (4 / beatType);
    const countInDuration = beatSeconds * beats;
    for (let beat = 0; beat < beats; beat += 1) this.#scheduleClick(start + beat * beatSeconds, beat === 0);
    if (pianoSound) {
      events
        .filter((event) => hands === "both" || (hands === "left" ? event.staff > 1 : event.staff === 1))
        .forEach((event) => this.#playNote(event.midi, start + countInDuration + event.onset * secondsPerQuarter, event.duration * secondsPerQuarter));
    }
    return {
      countInStart: start,
      scoreStart: start + countInDuration,
      endAt: start + countInDuration + duration * secondsPerQuarter,
      secondsPerQuarter,
    };
  }

  stop() {
    const now = this.now;
    this.piano?.stop(now);
    this.activeOscillators.forEach((oscillator) => {
      try { oscillator.stop(now); } catch { }
    });
    this.activeOscillators.clear();
  }

  #scheduleClick(time, accented) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accented ? 1760 : 1320, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accented ? 0.22 : 0.13, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.075);
    oscillator.connect(gain).connect(this.master);
    this.#track(oscillator, time, time + 0.08);
  }

  #playNote(midi, time, duration) {
    if (this.piano?.ready) {
      this.piano.play(midi, time, duration);
      return;
    }
    this.#scheduleSynth(midi, time, duration);
  }

  #scheduleSynth(midi, time, duration) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    PARTIALS.forEach((partial) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const release = Math.max(0.14, Math.min(2.8, duration * 1.6));
      oscillator.type = partial.type;
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(partial.gain, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + release);
      oscillator.connect(gain).connect(this.master);
      this.#track(oscillator, time, time + release + 0.02);
    });
  }

  #track(oscillator, start, stop) {
    this.activeOscillators.add(oscillator);
    oscillator.onended = () => this.activeOscillators.delete(oscillator);
    oscillator.start(start);
    oscillator.stop(stop);
  }
}
