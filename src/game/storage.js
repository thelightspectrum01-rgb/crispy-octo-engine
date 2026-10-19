// localStorage wrapper that never throws (private windows, blocked storage, previews...).

const PREFIX = 'deskcoaster.v1.';
const mem = new Map();

export function load(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  return mem.has(key) ? mem.get(key) : fallback;
}

export function save(key, value) {
  mem.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_SETTINGS = {
  quality: 'auto', // auto | high | medium | low
  sound: true,
  music: true,
  laps: 3,
  ghost: 'auto', // auto | pb | rival | off
  camera: 'chase', // chase | onboard | overview
  hints: true, // braking hints
  tips: {},
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(load('settings', {}) ?? {}) };
}

export function saveSettings(s) {
  save('settings', s);
}

/* --------------------------------------------------------------- records */

const recKey = (trackId, laps) => `rec.${trackId}.${laps}`;

/** Personal best record: { total, laps: number[], ghost: string(base64) | null, date } */
export function loadRecord(trackId, laps) {
  return load(recKey(trackId, laps), null);
}

export function saveRecord(trackId, laps, rec) {
  return save(recKey(trackId, laps), rec);
}

export function loadMedals(trackId) {
  return load(`medals.${trackId}`, {}) ?? {};
}

export function saveMedal(trackId, laps, medal) {
  const m = loadMedals(trackId);
  const rank = { none: 0, bronze: 1, silver: 2, gold: 3 };
  if ((rank[medal] ?? 0) > (rank[m[laps]] ?? 0)) {
    m[laps] = medal;
    save(`medals.${trackId}`, m);
  }
  return m;
}
