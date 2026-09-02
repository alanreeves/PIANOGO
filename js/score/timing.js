function child(element, name) {
  return [...element.children].find((candidate) => candidate.localName === name);
}

function childText(element, name, fallback = "") {
  return child(element, name)?.textContent?.trim() || fallback;
}

function noteMidi(note) {
  const pitch = child(note, "pitch");
  if (!pitch) return null;
  const steps = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const step = steps[childText(pitch, "step")];
  const octave = Number(childText(pitch, "octave"));
  const alter = Number(childText(pitch, "alter", "0"));
  return Number.isFinite(step) && Number.isFinite(octave) ? 12 * (octave + 1) + step + alter : null;
}

function hasTieStop(note) {
  return [...note.children].some((element) => element.localName === "tie" && element.getAttribute("type") === "stop");
}

export function buildTimeline(document) {
  const part = document.querySelector("part");
  if (!part) throw new Error("The score does not contain a playable part.");
  let divisions = 1;
  let timeSignature = "4/4";
  let scoreQuarter = 0;
  const events = [];
  const measures = [];
  const sourceMeasures = [...part.children].filter((element) => element.localName === "measure");

  sourceMeasures.forEach((measure, index) => {
    const measureStart = scoreQuarter;
    let cursor = 0;
    let maxCursor = 0;
    let lastOnset = 0;
    const attributes = child(measure, "attributes");
    if (attributes) {
      divisions = Number(childText(attributes, "divisions", String(divisions))) || divisions;
      const time = child(attributes, "time");
      if (time) timeSignature = `${childText(time, "beats", "4")}/${childText(time, "beat-type", "4")}`;
    }

    [...measure.children].forEach((entry) => {
      if (entry.localName === "backup") {
        cursor = Math.max(0, cursor - Number(childText(entry, "duration", "0")));
        return;
      }
      if (entry.localName === "forward") {
        cursor += Number(childText(entry, "duration", "0"));
        maxCursor = Math.max(maxCursor, cursor);
        return;
      }
      if (entry.localName !== "note") return;
      const duration = Number(childText(entry, "duration", "0"));
      const isChord = Boolean(child(entry, "chord"));
      const onset = isChord ? lastOnset : cursor;
      const midi = noteMidi(entry);
      const isRest = Boolean(child(entry, "rest"));
      if (!isRest && midi !== null && !hasTieStop(entry)) {
        events.push({
          onset: measureStart + onset / divisions,
          duration: Math.max(duration / divisions, 0.05),
          midi,
          staff: Number(childText(entry, "staff", "1")) || 1,
          measure: index + 1,
        });
      }
      if (!isChord) {
        lastOnset = onset;
        cursor += duration;
        maxCursor = Math.max(maxCursor, cursor);
      }
    });

    const [beats, unit] = timeSignature.split("/").map(Number);
    const expectedDuration = divisions * beats * (4 / unit);
    const duration = Math.max(maxCursor, expectedDuration) / divisions;
    scoreQuarter += duration;
    measures.push({ number: index + 1, start: measureStart, duration, end: scoreQuarter });
  });

  return { events: events.sort((left, right) => left.onset - right.onset), measures, timeSignature };
}

export function buildPdfTimeline(calibration, timeSignature = "4/4") {
  const [beats, unit] = (timeSignature || calibration.timeSignature || "4/4").split("/").map(Number);
  const barDurationQuarters = beats * (4 / unit);
  let scoreQuarter = 0;
  const measures = [];
  const events = [];

  calibration.bars.forEach((bar, index) => {
    const measureStart = scoreQuarter;
    scoreQuarter += barDurationQuarters;
    measures.push({
      number: bar.barNumber || (index + 1),
      start: measureStart,
      duration: barDurationQuarters,
      end: scoreQuarter,
    });
  });

  return { events, measures, timeSignature: `${beats}/${unit}` };
}

export function selectRange(timeline, startBar, endBar) {
  const selectedMeasures = timeline.measures.slice(startBar - 1, endBar);
  if (!selectedMeasures.length) throw new Error("Choose a valid bar range.");
  const start = selectedMeasures[0].start;
  const end = selectedMeasures.at(-1).end;
  return {
    measures: selectedMeasures,
    duration: end - start,
    events: timeline.events
      .filter((event) => event.onset >= start && event.onset < end)
      .map((event) => ({ ...event, onset: event.onset - start })),
  };
}

export function parseTimeSignature(value, fallback) {
  const signature = value.trim().toLowerCase() === "auto" ? fallback : value.trim();
  const match = signature.match(/^([1-9][0-9]?)\/([1-9][0-9]?)$/);
  if (!match) throw new Error("Use auto or a count-in signature such as 4/4.");
  return { label: signature, beats: Number(match[1]), beatType: Number(match[2]) };
}
