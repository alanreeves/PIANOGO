function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${remainder}s`;
  return `${minutes}m${remainder ? ` ${remainder}s` : ""}`;
}

export function renderStats(stats) {
  document.querySelector("#stat-clean-runs").textContent = stats.cleanRuns;
  document.querySelector("#stat-top-bpm").textContent = stats.topCleanTempo || "—";
  document.querySelector("#stat-repetitions").textContent = stats.repetitions;
  document.querySelector("#stat-time").textContent = formatTime(stats.seconds);
}
