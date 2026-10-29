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

export async function loadModules() {
  if (modules) return modules;
  const index = await fetchJson('data/index.json');
  for (const mod of index.modules) {
    mod.decks = await Promise.all(mod.decks.map(async path => {
      const deck = await fetchJson(path);
      const used = new Set();
      for (const card of deck.cards) {
        let id = card.id || `${deck.id}:${slug(card.term)}`;
        for (let n = 2; used.has(id); n++) id = `${card.id || `${deck.id}:${slug(card.term)}`}-${n}`;
        used.add(id);
        card.id = id;
        card.deck = deck.id;
        card.category ||= deck.category || 'word';
      }
      return deck;
    }));
    mod.cards = mod.decks.flatMap(d => d.cards);
  }
  modules = index.modules;
  return modules;
}

export function findModule(id) {
  return modules?.find(m => m.id === id);
}
