// Ablauf einer Übungseinheit: Lernen (Spaced Repetition), Schwachstellen oder Prüfungssimulation.
import { state, save, dayStats } from './store.js';
import { grade, recordConfusion, buildOptions, ownerOf } from './srs.js';
import { CATEGORY_LABELS } from './data.js';
import { esc } from './ui.js';

const LETTERS = 'ABCDEFGH';
const FORWARD_PROMPTS = {
  synonym: 'Welches Wort hat die gleiche Bedeutung?',
  idiom: 'Was bedeutet diese Redewendung?',
  phrase: 'Was bedeutet diese Phrase?',
  word: 'Was bedeutet dieser Begriff?',
};

export function runQuiz(root, { mod, mode, items, onDone }) {
  const s = state.settings;
  const timerSec = mode === 'exam' ? s.examTimer : s.timer;
  const slowMs = timerSec ? timerSec * 700 : 12000;
  const queue = items.slice();
  const total = mode === 'exam' ? queue.length : null;
  const stats = { answered: 0, correct: 0, started: Date.now(), mistakes: new Map() };
  const deckById = new Map(mod.decks.map(d => [d.id, d]));
  let current = null;
  let options = [];
  let shownAt = 0;
  let pending = null;
  let timerId = null;
  let advanceId = null;

  function progress() {
    if (total) return { done: stats.answered, all: total };
    return { done: stats.answered, all: stats.answered + queue.length + (pending ? 0 : 1) };
  }

  function show() {
    clearTimeout(advanceId);
    if (!queue.length) return finish();
    current = queue.shift();
    options = buildOptions(current, mod);
    pending = null;
    const { card, dir } = current;
    const deck = deckById.get(card.deck);
    const prompt = dir === 'f' ? deck?.prompt || FORWARD_PROMPTS[card.category] || FORWARD_PROMPTS.word
      : 'Welcher Ausdruck passt zu dieser Bedeutung?';
    const p = progress();
    root.innerHTML = `
      <div class="quiz">
        <header class="quiz-top">
          <button class="icon-btn" data-act="quit" aria-label="Beenden">✕</button>
          <div class="bar"><div style="width:${Math.round(p.done / Math.max(1, p.all) * 100)}%"></div></div>
          <span class="muted small">${p.done + 1}/${p.all}</span>
        </header>
        ${timerSec ? '<div class="timer"><div></div></div>' : ''}
        <section class="prompt">
          <span class="tag tag-${esc(card.category)}">${esc(CATEGORY_LABELS[card.category] || card.category)}${dir === 'r' ? ' · umgekehrt' : ''}</span>
          <p class="muted">${esc(prompt)}</p>
          <h2 class="term">${esc(dir === 'f' ? card.term : card.answer)}</h2>
        </section>
        <div class="options">
          ${options.map((o, i) => `<button class="option" data-i="${i}"><span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span></button>`).join('')}
        </div>
        <div class="feedback" aria-live="polite"></div>
      </div>`;
    shownAt = Date.now();
    if (timerSec) {
      const bar = root.querySelector('.timer div');
      requestAnimationFrame(() => {
        bar.style.transition = `width ${timerSec}s linear`;
        bar.style.width = '0%';
      });
      timerId = setTimeout(() => answer(-1), timerSec * 1000);
    }
  }

  function answer(i) {
    if (pending) return;
    clearTimeout(timerId);
    const ms = Date.now() - shownAt;
    const correctText = current.dir === 'f' ? current.card.answer : current.card.term;
    const chosen = i >= 0 ? options[i] : null;
    const ok = chosen === correctText;
    pending = { ok, chosen, ms, guessed: false };

    stats.answered++;
    if (ok) stats.correct++;
    else stats.mistakes.set(current.key, { item: current, chosen });
    const day = dayStats(mod.id);
    day.answered++;
    if (ok) day.correct++;
    if (!ok && chosen) recordConfusion(current.key, chosen);

    const timerBar = root.querySelector('.timer div');
    if (timerBar) {
      timerBar.style.transition = 'none';
      timerBar.style.width = getComputedStyle(timerBar).width;
    }
    root.querySelectorAll('.option').forEach((b, j) => {
      b.disabled = true;
      if (options[j] === correctText) b.classList.add('correct');
      else if (j === i) b.classList.add('wrong');
      else b.classList.add('dim');
    });

    if (mode === 'exam') {
      commit();
      advanceId = setTimeout(show, 350);
      return;
    }
    renderFeedback(correctText);
    if (ok && state.settings.autoAdvance) advanceId = setTimeout(next, 1400);
  }

  function renderFeedback(correctText) {
    const { card, dir } = current;
    const fb = root.querySelector('.feedback');
    let html;
    if (pending.ok) {
      html = `<p class="result ok">Richtig${pending.ms > slowMs ? ' – aber langsam' : ''}</p>`;
    } else {
      html = `<p class="result bad">${pending.chosen ? 'Falsch' : 'Zeit abgelaufen'}</p>
        <p><strong>${esc(card.term)}</strong> = ${esc(card.answer)}</p>`;
      const owner = pending.chosen && ownerOf(mod, pending.chosen, dir);
      if (owner) html += `<p class="muted">„${esc(pending.chosen)}“ gehört zu: <strong>${esc(owner.term)}</strong> = ${esc(owner.answer)}</p>`;
    }
    if (card.alt?.length) html += `<p class="muted">Auch: ${esc(card.alt.join(', '))}</p>`;
    if (card.example) html += `<p class="example">${esc(card.example)}</p>`;
    if (card.note) html += `<p class="muted">${esc(card.note)}</p>`;
    html += `<div class="row">
      ${pending.ok ? '<button class="btn ghost" data-act="guessed">Nur geraten</button>' : ''}
      <button class="btn primary" data-act="next">Weiter</button></div>`;
    fb.innerHTML = html;
    fb.querySelector('[data-act="next"]').focus({ preventScroll: true });
    fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Bewertung erst beim Weitergehen anwenden, damit „Nur geraten“ sie noch ändern kann.
  function commit() {
    if (!pending || pending.committed) return;
    pending.committed = true;
    const { ok, guessed, ms } = pending;
    if (mode === 'learn') {
      const g = !ok || guessed ? 1 : ms > slowMs ? 2 : 3;
      const res = grade(current.key, g);
      if (res.wasNew) dayStats(mod.id).new++;
      if (res.requeue) requeue();
    } else if (mode === 'weak') {
      if (!ok || guessed) {
        grade(current.key, 1);
        requeue();
      }
    } else if (mode === 'exam' && !ok) {
      grade(current.key, 1);
    }
    save();
  }

  function requeue() {
    const pos = Math.min(queue.length, 3 + Math.floor(Math.random() * 3));
    queue.splice(pos, 0, current);
  }

  function next() {
    clearTimeout(advanceId);
    commit();
    show();
  }

  function finish() {
    cleanup();
    onDone({ ...stats, mode, seconds: Math.round((Date.now() - stats.started) / 1000) });
  }

  function quit() {
    clearTimeout(timerId);
    clearTimeout(advanceId);
    if (pending) commit();
    finish();
  }

  function onClick(e) {
    const opt = e.target.closest('.option');
    if (opt && !opt.disabled) return answer(Number(opt.dataset.i));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'quit') quit();
    else if (act === 'next') next();
    else if (act === 'guessed') {
      clearTimeout(advanceId);
      pending.guessed = true;
      const btn = e.target.closest('button');
      btn.disabled = true;
      btn.textContent = 'Kommt nochmal';
    }
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toUpperCase();
    const idx = '12345678'.indexOf(k) >= 0 ? '12345678'.indexOf(k) : LETTERS.indexOf(k);
    if (!pending && idx >= 0 && idx < options.length) answer(idx);
    else if (pending && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
    else if (e.key === 'Escape') quit();
  }

  function cleanup() {
    clearTimeout(timerId);
    clearTimeout(advanceId);
    root.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  }

  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  show();
  return { stop: cleanup };
}
