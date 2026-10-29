// Lernfortschritt und Einstellungen, gespeichert im Browser (localStorage).
const KEY = 'sprachtrainer.v1';

const DEFAULTS = {
  settings: {
    newPerDay: 20,
    options: 5,
    timer: 0,
    examTimer: 20,
    examCount: 30,
    reverse: true,
    retention: 0.9,
    examDate: '',
    autoAdvance: true,
  },
  items: {},
  days: {},
  disabledDecks: {},
};

export const state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch (e) {
    console.warn('Speicher nicht lesbar', e);
  }
  return structuredClone(DEFAULTS);
}

function merge(data) {
  return {
    ...structuredClone(DEFAULTS),
    ...data,
    settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
  };
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', e);
  }
}

export function replaceState(data) {
  const next = merge(data);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
  save();
}

export function resetProgress() {
  state.items = {};
  state.days = {};
  save();
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayStats(moduleId, t = Date.now()) {
  const day = (state.days[dayKey(t)] ||= {});
  return (day[moduleId] ||= { new: 0, answered: 0, correct: 0 });
}

export function streak() {
  let n = 0;
  const d = new Date();
  const active = key => Object.values(state.days[key] || {}).some(m => m.answered > 0);
  if (!active(dayKey(d))) d.setDate(d.getDate() - 1);
  while (active(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// Auf iOS werden Daten nicht installierter Webseiten nach längerer Pause evtl. gelöscht.
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
