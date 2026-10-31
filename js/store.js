// Recordings live in IndexedDB on the device. Nothing leaves the browser.
// Adapted from Lull v2's store.js: same transaction helper, a different database and row shape
// ({id, name, sr, pcm: Float32Array, created}).

const DB_NAME = 'geometric-jelly';
const STORE = 'samples';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

export async function listSamples() {
  const rows = await tx('readonly', (s) => s.getAll());
  return (rows || []).sort((a, b) => a.created - b.created);
}

export function saveSample(row) {
  return tx('readwrite', (s) => s.put(row));
}

export function deleteSample(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {
    /* not available */
  }
}
