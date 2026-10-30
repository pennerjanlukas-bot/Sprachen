// Planung der Wiederholungen, Zusammenstellung der Lerneinheiten und Auswahl der Antwortoptionen.
import { review, intervalDays, retrievability } from './fsrs.js';
import { state, dayStats } from './store.js';

const DAY = 86400000;
const MIN = 60000;

export const startOfDay = (t = Date.now()) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const endOfDay = (t = Date.now()) => startOfDay(t) + DAY - 1;

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Jede Karte wird in zwei Richtungen geübt: Begriff → Bedeutung (f) und Bedeutung → Begriff (r).
export function itemsOf(mod) {
  const items = [];
  for (const card of mod.cards) {
    if (state.disabledDecks[card.deck]) continue;
    items.push({ key: `${card.id}|f`, card, dir: 'f' });
    items.push({ key: `${card.id}|r`, card, dir: 'r' });
  }
  return items;
}

// Fünf Lager nach Gedächtnisstabilität (Tage, bis die Erinnerung auf 90 % fällt). 0 = noch neu.
export const LAGER = [
  { n: 1, name: 'Kritisch', hint: 'gerade gelernt oder vergessen' },
  { n: 2, name: 'Unsicher', hint: 'sitzt ein paar Tage' },
  { n: 3, name: 'Solide', hint: 'sitzt 1–2 Wochen' },
  { n: 4, name: 'Sicher', hint: 'sitzt mehrere Wochen' },
  { n: 5, name: 'Perfekt', hint: 'sitzt über einen Monat' },
];

export function itemLager(key) {
  const m = state.items[key];
  if (!m || m.state === 'new') return 0;
  if (m.state !== 'review' || m.s < 2) return 1;
  if (m.s < 6) return 2;
  if (m.s < 15) return 3;
  if (m.s < 35) return 4;
  return 5;
}

// Eine Karte steht im Lager ihrer schwächeren Richtung – sie gilt erst als gut, wenn beide sitzen.
export function cardLager(card) {
  const f = itemLager(`${card.id}|f`);
  if (!state.settings.reverse || f === 0) return f;
  const r = itemLager(`${card.id}|r`);
  return r === 0 ? 1 : Math.min(f, r);
}

export function daysUntilExam(now = Date.now()) {
  if (!state.settings.examDate) return null;
  const exam = new Date(`${state.settings.examDate}T00:00:00`).getTime();
  return Math.round((exam - startOfDay(now)) / DAY);
}

// Vor dem Testtermin werden Intervalle gekappt, damit jede Karte vorher noch einmal drankommt.
function maxInterval(now) {
  const days = daysUntilExam(now);
  return days !== null && days >= 2 ? Math.min(365, days - 1) : 365;
}

// g: 1 = falsch/geraten, 2 = richtig aber langsam, 3 = richtig, 4 = leicht.
export function grade(key, g, now = Date.now()) {
  const m = (state.items[key] ||= { state: 'new', reps: 0, lapses: 0 });
  const wasNew = m.state === 'new';
  const firstTime = wasNew || m.state === 'learning';
  const next = review(m.s ? m : null, g, now);
  m.s = next.s;
  m.d = next.d;
  m.last = now;
  m.reps++;

  if (g === 1) {
    if (m.state === 'review') m.lapses++;
    m.state = wasNew || m.state === 'learning' ? 'learning' : 'relearning';
    m.step = 0;
    m.due = now + 5 * MIN;
    return { wasNew, requeue: true };
  }
  // Neue Karten müssen in der ersten Einheit zweimal richtig beantwortet werden.
  if ((wasNew || m.state === 'learning') && (m.step || 0) < 1 && g < 4) {
    m.state = 'learning';
    m.step = 1;
    m.due = now + 10 * MIN;
    return { wasNew, requeue: true };
  }
  m.state = 'review';
  m.step = 0;
  let ivl = Math.round(intervalDays(m.s, state.settings.retention));
  if (ivl > 2) ivl = Math.round(ivl * (0.95 + Math.random() * 0.1));
  ivl = Math.min(Math.max(1, ivl), maxInterval(now));
  m.ivl = ivl;
  m.due = startOfDay(now) + ivl * DAY;
  return { wasNew, requeue: false, graduated: firstTime };
}

export function recordConfusion(key, chosen) {
  const m = (state.items[key] ||= { state: 'new', reps: 0, lapses: 0 });
  m.conf ||= {};
  m.conf[chosen] = (m.conf[chosen] || 0) + 1;
}

function newCandidates(mod) {
  const forward = [];
  const reverse = [];
  for (const it of itemsOf(mod)) {
    const m = state.items[it.key];
    if (m && m.state !== 'new') continue;
    if (it.dir === 'f') forward.push(it);
    else if (state.settings.reverse) {
      const fm = state.items[`${it.card.id}|f`];
      if (fm?.state === 'review') reverse.push(it);
    }
  }
  return { forward, reverse };
}

export function overview(mod, now = Date.now()) {
  const end = endOfDay(now);
  let due = 0, tomorrow = 0, week = 0;
  const lager = [0, 0, 0, 0, 0, 0];
  for (const it of itemsOf(mod)) {
    const m = state.items[it.key];
    if (it.dir === 'f') lager[cardLager(it.card)]++;
    if (!m || m.state === 'new') continue;
    if (m.due <= end) due++;
    else if (m.due <= end + DAY) tomorrow++;
    if (m.due > end && m.due <= end + 7 * DAY) week++;
  }
  const { forward, reverse } = newCandidates(mod);
  const newLeft = Math.max(0, state.settings.newPerDay - dayStats(mod.id).new);
  const newToday = Math.min(newLeft, forward.length) + reverse.length;
  const today = startOfDay(now);
  const reviewedToday = itemsOf(mod).filter(it => state.items[it.key]?.last >= today).length;
  return { due, tomorrow, week, newToday, lager, reviewedToday, total: lager.reduce((a, b) => a + b, 0) };
}

// Neue Karten abwechselnd aus allen Kartensätzen, damit Kategorien gemischt werden.
function roundRobin(items) {
  const byDeck = new Map();
  for (const it of shuffle(items)) {
    if (!byDeck.has(it.card.deck)) byDeck.set(it.card.deck, []);
    byDeck.get(it.card.deck).push(it);
  }
  const lists = [...byDeck.values()];
  const out = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const l of lists) if (l[i]) out.push(l[i]);
  }
  return out;
}

export function buildLearnSession(mod, limit = 60, now = Date.now()) {
  const end = endOfDay(now);
  const due = itemsOf(mod)
    .filter(it => { const m = state.items[it.key]; return m && m.state !== 'new' && m.due <= end; })
    .sort((a, b) => state.items[a.key].due - state.items[b.key].due);
  const { forward, reverse } = newCandidates(mod);
  const newLeft = Math.max(0, state.settings.newPerDay - dayStats(mod.id).new);
  // Rückrichtungen bereits gelernter Karten zählen nicht zum Tageslimit für neue Karten.
  const news = [...shuffle(reverse), ...roundRobin(forward).slice(0, newLeft)];

  // Nach jeweils vier Wiederholungen eine neue Karte einstreuen.
  const queue = [];
  let ni = 0;
  due.forEach((it, i) => {
    queue.push(it);
    if ((i + 1) % 4 === 0 && ni < news.length) queue.push(news[ni++]);
  });
  while (ni < news.length) queue.push(news[ni++]);
  return queue.slice(0, limit);
}

// Alle heute schon geübten Karten noch einmal – beliebig oft.
export function buildRepeatSession(mod, now = Date.now()) {
  const today = startOfDay(now);
  return shuffle(itemsOf(mod).filter(it => state.items[it.key]?.last >= today));
}

export function buildLagerSession(mod, n) {
  return shuffle(itemsOf(mod).filter(it => itemLager(it.key) === n));
}

// Endlos-Modus: fällige Karten zuerst, dann abwechselnd die am ehesten vergessenen und neue Karten.
export function endlessBatch(mod, exclude, size = 10, now = Date.now()) {
  const end = endOfDay(now);
  const items = itemsOf(mod).filter(it => !exclude.has(it.key));
  const due = [], review = [];
  for (const it of items) {
    const m = state.items[it.key];
    if (!m || m.state === 'new') continue;
    if (m.due <= end) due.push(it);
    else review.push({ it, r: retrievability(Math.max(0, (now - m.last) / DAY), m.s) });
  }
  due.sort((a, b) => state.items[a.key].due - state.items[b.key].due);
  review.sort((a, b) => a.r - b.r);
  const { forward, reverse } = newCandidates(mod);
  const fresh = [...shuffle(reverse), ...roundRobin(forward)].filter(it => !exclude.has(it.key));

  const batch = due.slice(0, size);
  let ri = 0, ni = 0;
  while (batch.length < size && (ri < review.length || ni < fresh.length)) {
    if (ri < review.length && review[ri].r < 0.97) batch.push(review[ri++].it);
    if (batch.length < size && ri < review.length && review[ri].r < 0.97) batch.push(review[ri++].it);
    if (batch.length < size && ni < fresh.length) batch.push(fresh[ni++]);
    // Alles neu gelernt und gut im Gedächtnis: dann die am wenigsten sicheren Karten wiederholen.
    if (ni >= fresh.length && ri < review.length && review[ri].r >= 0.97) batch.push(review[ri++].it);
  }
  return batch;
}

export function buildExamSession(mod, count) {
  const items = itemsOf(mod).filter(it => it.dir === 'f');
  return shuffle(items).slice(0, count);
}

export function weakItems(mod, now = Date.now()) {
  const scored = [];
  for (const it of itemsOf(mod)) {
    const m = state.items[it.key];
    if (!m || m.state === 'new') continue;
    const conf = Object.values(m.conf || {}).reduce((a, b) => a + b, 0);
    const r = m.s ? retrievability(Math.max(0, (now - m.last) / DAY), m.s) : 0;
    const weakness = m.lapses * 2 + conf + (m.state !== 'review' ? 2 : 0) + (1 - r) * 4 + (m.d || 5) / 5;
    if (m.lapses > 0 || conf > 0 || m.state !== 'review' || r < 0.85) scored.push({ it, weakness });
  }
  return scored.sort((a, b) => b.weakness - a.weakness).map(x => x.it);
}

// ---- Antwortoptionen ----

const norm = s => s.trim().toLowerCase();
const isUpper = s => s[0] !== s[0].toLowerCase();

// Ähnlich aussehende Ablenker sind schwerer zu erraten (gleiche Endung, Länge, Wortanzahl, Wortart).
function similarity(a, b) {
  let sc = -Math.abs(a.length - b.length) / Math.max(a.length, b.length) * 2;
  const wa = a.split(/\s+/).length, wb = b.split(/\s+/).length;
  sc += wa === wb ? 1 : -Math.min(2, Math.abs(wa - wb)) * 0.5;
  if (isUpper(a) === isUpper(b)) sc += 0.7;
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la.slice(-3) === lb.slice(-3)) sc += 1.2;
  else if (la.slice(-2) === lb.slice(-2)) sc += 0.6;
  return sc;
}

// Deutsche Übersetzung als Wortmenge, um Bedeutungsgleiche Karten zu erkennen.
const germanWords = c => new Set((c.note || '').replace(/^Deutsch:/, '').toLowerCase()
  .split(/[^a-zäöüß]+/).filter(w => w.length > 3 && !['etwas', 'jemanden', 'sich'].includes(w)));

const meanings = c => new Set([c.term, c.answer, ...(c.alt || [])].map(norm));

// Karten mit überschneidender Bedeutung dürfen nicht als „falsche“ Antwort erscheinen.
function overlaps(a, b) {
  const ma = meanings(a), mb = meanings(b);
  for (const m of ma) if (mb.has(m)) return true;
  const ga = germanWords(a);
  for (const w of germanWords(b)) if (ga.has(w)) return true;
  return false;
}

export function buildOptions(item, mod, n = state.settings.options) {
  const { card, dir } = item;
  const field = dir === 'f' ? 'answer' : 'term';
  const correct = card[field];
  const banned = new Set([norm(correct), ...(dir === 'f' ? card.alt || [] : []).map(norm)]);
  const picked = [];
  const add = text => {
    if (!text || picked.length >= n - 1) return;
    const k = norm(text);
    if (banned.has(k)) return;
    banned.add(k);
    picked.push(text);
  };

  // 1. Ablenker aus den Vorbereitungsunterlagen
  if (dir === 'f') shuffle(card.distractors || []).forEach(add);

  // 2. Früher verwechselte Antworten (max. 2), damit Verwechslungen gezielt geübt werden
  const conf = state.items[item.key]?.conf || {};
  Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([t]) => add(t));

  // 3. Ähnliche Antworten anderer Karten, bevorzugt aus derselben Kategorie
  const pool = mod.cards
    .filter(c => c !== card && !overlaps(card, c))
    .map(c => ({
      text: c[field],
      score: (c.category === card.category ? 3 : 0) + similarity(correct, c[field]) + Math.random() * 1.5,
    }))
    .sort((a, b) => b.score - a.score);
  shuffle(pool.slice(0, Math.max(8, n * 2))).forEach(p => add(p.text));
  pool.forEach(p => add(p.text));

  return shuffle([correct, ...picked]);
}

// Zu einer gewählten falschen Antwort die Karte finden, zu der sie eigentlich gehört.
export function ownerOf(mod, text, dir) {
  const field = dir === 'f' ? 'answer' : 'term';
  return mod.cards.find(c => norm(c[field]) === norm(text));
}
