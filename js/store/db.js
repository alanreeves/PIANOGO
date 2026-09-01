const DATABASE_NAME = "pianogo";
const DATABASE_VERSION = 1;

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("scores")) database.createObjectStore("scores", { keyPath: "id" });
      if (!database.objectStoreNames.contains("sessions")) {
        const sessions = database.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        sessions.createIndex("scoreId", "scoreId");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

async function transaction(storeName, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = operation(database.transaction(storeName, mode).objectStore(storeName));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveScore(score) {
  return transaction("scores", "readwrite", (store) => store.put({ ...score, savedAt: Date.now() }));
}

export async function getLatestScore() {
  const scores = await transaction("scores", "readonly", (store) => store.getAll());
  return scores.reduce((latest, score) => !latest || score.savedAt > latest.savedAt ? score : latest, null);
}

export async function saveSession(session) {
  return transaction("sessions", "readwrite", (store) => store.add({ ...session, createdAt: Date.now() }));
}

export async function getScoreSessions(scoreId) {
  return transaction("sessions", "readonly", (store) => store.index("scoreId").getAll(scoreId));
}

export async function getStats(scoreId) {
  const sessions = await getScoreSessions(scoreId);
  return sessions.reduce(
    (stats, session) => ({
      cleanRuns: stats.cleanRuns + session.cleanRuns,
      repetitions: stats.repetitions + session.repetitions,
      seconds: stats.seconds + session.seconds,
      topCleanTempo: Math.max(stats.topCleanTempo, session.cleanRuns > 0 ? session.finalTempo : 0),
    }),
    { cleanRuns: 0, repetitions: 0, seconds: 0, topCleanTempo: 0 },
  );
}
