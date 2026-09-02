export function createEmptyCalibration(title = "PDF Score", timeSignature = "4/4") {
  return {
    title,
    timeSignature,
    pages: [],
    bars: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function exportCalibrationFile(calibration, filename = "score-calibration.pianogo.json") {
  const content = JSON.stringify(calibration, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseCalibrationJson(jsonString) {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data.bars)) {
    throw new Error("Invalid calibration file: missing bars array.");
  }
  return {
    title: data.title || "Imported Score",
    timeSignature: data.timeSignature || "4/4",
    pages: data.pages || [],
    bars: data.bars.map((bar, index) => ({
      barNumber: Number(bar.barNumber) || (index + 1),
      page: Number(bar.page) || 1,
      systemIndex: Number(bar.systemIndex) || 0,
      x1: Number(bar.x1) || 0,
      x2: Number(bar.x2) || 0,
      y1: Number(bar.y1) || 0,
      y2: Number(bar.y2) || 0,
    })),
    createdAt: data.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}
