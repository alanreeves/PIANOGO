const PITCHES = [
  21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108,
];
const SAMPLE_CACHE = "piano-samples-v1";
const RELEASE = 0.25;
const LEVEL = 0.85;

export class PianoSampler {
  #context;
  #destination;
  #buffers = new Map();
  #voices = new Set();
  #loading = null;

  constructor(context, destination) {
    this.#context = context;
    this.#destination = destination;
  }

  get ready() {
    return this.#buffers.size > 0;
  }

  load() {
    if (!this.#loading) {
      this.#loading = this.#loadAll().then(() => {
        if (!this.#buffers.size) this.#loading = null;
      });
    }
    return this.#loading;
  }

  play(midi, when, duration) {
    const sample = this.#nearest(midi);
    if (!sample) return;
    const source = this.#context.createBufferSource();
    const gain = this.#context.createGain();
    const off = when + Math.max(0.12, duration);
    source.buffer = sample.buffer;
    source.playbackRate.value = 2 ** ((midi - sample.pitch) / 12);
    gain.gain.setValueAtTime(LEVEL, when);
    gain.gain.setValueAtTime(LEVEL, off);
    gain.gain.exponentialRampToValueAtTime(0.0001, off + RELEASE);
    source.connect(gain).connect(this.#destination);
    source.onended = () => this.#voices.delete(voice);
    const voice = { source, gain };
    this.#voices.add(voice);
    source.start(when);
    source.stop(off + RELEASE + 0.02);
  }

  stop(now) {
    this.#voices.forEach(({ source, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      source.stop(now + 0.07);
    });
    this.#voices.clear();
  }

  async #loadAll() {
    const cache = "caches" in self ? await caches.open(SAMPLE_CACHE).catch(() => null) : null;
    await Promise.all(PITCHES.map(async (pitch) => {
      try {
        this.#buffers.set(pitch, await this.#decode(pitch, cache));
      } catch {
        // A missing or offline-unreachable sample leaves that pitch to the synthesizer fallback.
      }
    }));
  }

  async #decode(pitch, cache) {
    const url = new URL(`../../assets/piano/${pitch}.mp3`, import.meta.url).href;
    const cached = cache && (await cache.match(url));
    const response = cached || await fetch(url);
    if (!response.ok) throw new Error(`Piano sample ${pitch} is unavailable.`);
    if (!cached && cache) await cache.put(url, response.clone()).catch(() => {});
    return this.#context.decodeAudioData(await response.arrayBuffer());
  }

  #nearest(midi) {
    let best = null;
    this.#buffers.forEach((buffer, pitch) => {
      const distance = Math.abs(pitch - midi);
      if (!best || distance < best.distance) best = { pitch, buffer, distance };
    });
    return best;
  }
}
