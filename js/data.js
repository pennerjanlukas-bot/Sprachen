import { loadPacks } from './store.js';

// Lädt die Module (Sprachen/Schwerpunkte) und ihre Kartensätze aus data/.
let modules = null;

export const CATEGORY_LABELS = {
  synonym: 'Synonym',
  phrase: 'Phrase',
  idiom: 'Redewendung',
  proverb: 'Sprichwort',
  word: 'Vokabel',
};

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function prepareDeck(deck) {
  const used = new Set();
  for (const card of deck.cards) {
    const base = card.id || `${deck.id}:${slug(card.term)}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    card.id = id;
    card.deck = deck.id;
    card.category ||= deck.category || 'word';
  }
  return deck;
}

export async function loadModules() {
  if (modules) return modules;
  const index = await fetchJson('data/index.json');
  for (const mod of index.modules) {
    mod.decks = await Promise.all(mod.decks.map(async path => prepareDeck(await fetchJson(path))));
  }
  // Auf dem Gerät importierte Pakete ergänzen bzw. ersetzen gleichnamige Kartensätze.
  for (const pack of Object.values(loadPacks())) {
    let mod = index.modules.find(m => m.id === pack.module.id);
    if (!mod) index.modules.push(mod = { ...pack.module, decks: [] });
    for (const deck of structuredClone(pack.decks)) {
      mod.decks = mod.decks.filter(d => d.id !== deck.id);
      mod.decks.push(prepareDeck(deck));
    }
  }
  for (const mod of index.modules) mod.cards = mod.decks.flatMap(d => d.cards);
  modules = index.modules;
  return modules;
}

export function reloadModules() {
  modules = null;
  return loadModules();
}

export function findModule(id) {
  return modules?.find(m => m.id === id);
}

// Prüft eine Kartendatei (erzeugt mit tools/convert_sp_pdf.py) und gibt das bereinigte Paket zurück.
export function parsePack(data) {
  if (data?.type !== 'sprachtrainer-pack' || !data.module?.id || !Array.isArray(data.decks)) {
    throw new Error('Das ist keine Kartendatei für den Sprachtrainer.');
  }
  const decks = data.decks
    .filter(d => d.id && Array.isArray(d.cards))
    .map(d => ({ ...d, cards: d.cards.filter(c => c.term && c.answer) }))
    .filter(d => d.cards.length);
  if (!decks.length) throw new Error('Die Datei enthält keine Karten.');
  return { type: data.type, module: data.module, decks };
}
