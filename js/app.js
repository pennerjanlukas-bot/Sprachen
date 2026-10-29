import { loadModules, findModule, CATEGORY_LABELS } from './data.js';
import { state, save, streak, dayStats, replaceState, resetProgress, requestPersistence } from './store.js';
import { overview, buildLearnSession, buildExamSession, weakItems, status, daysUntilExam } from './srs.js';
import { runQuiz } from './quiz.js';
import { esc, plural } from './ui.js';

const root = document.getElementById('app');
let activeQuiz = null;

const go = hash => { location.hash = hash; };

function route() {
  activeQuiz?.stop();
  activeQuiz = null;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  window.scrollTo(0, 0);
  if (parts[0] === 'settings') return renderSettings();
  const mod = parts[0] === 'm' && findModule(parts[1]);
  if (!mod) return renderHome();
  switch (parts[2]) {
    case 'learn': return startLearn(mod);
    case 'exam': return startQuiz(mod, 'exam', buildExamSession(mod, state.settings.examCount));
    case 'weak': return startQuiz(mod, 'weak', weakItems(mod).slice(0, 20));
    case 'cards': return renderCards(mod);
    default: return renderModule(mod);
  }
}

function header(title, back) {
  return `<header class="top">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Zurück">‹</a>` : '<span class="icon-spacer"></span>'}
    <h1>${esc(title)}</h1>
    <a class="icon-btn" href="#/settings" aria-label="Einstellungen">⚙︎</a>
  </header>`;
}

function examBanner() {
  const d = daysUntilExam();
  if (d === null || d < 0) return '';
  return `<div class="banner">${d === 0 ? 'Heute ist der Test – viel Erfolg!' : `Noch <strong>${plural(d, 'Tag', 'Tage')}</strong> bis zum Test`}</div>`;
}

function renderHome(modules = loadedModules) {
  const st = streak();
  root.innerHTML = `${header('Sprachtrainer')}
    <div class="page">
      ${examBanner()}
      ${st ? `<p class="muted center">🔥 ${plural(st, 'Tag', 'Tage')} in Folge gelernt</p>` : ''}
      ${modules.map(m => {
        const o = overview(m);
        return `<a class="card module" href="#/m/${esc(m.id)}">
          <div class="module-head">
            <div><h2>${esc(m.title)}</h2><p class="muted">${esc(m.subtitle || '')}</p></div>
            ${m.priority ? '<span class="tag tag-prio">Priorität</span>' : ''}
          </div>
          <p class="module-stats"><strong>${o.due}</strong> fällig · <strong>${o.newToday}</strong> neu · ${o.counts.known + o.counts.mastered}/${o.total} gelernt</p>
        </a>`;
      }).join('')}
      <div class="card placeholder"><h2>Weitere Sprachen</h2><p class="muted">Kommen später dazu – mit eigenen Schwerpunkten.</p></div>
    </div>`;
}

function renderModule(mod) {
  const o = overview(mod);
  const weak = weakItems(mod).length;
  const pct = n => (o.total ? (n / o.total) * 100 : 0);
  const today = dayStats(mod.id);
  root.innerHTML = `${header(mod.title, '#/')}
    <div class="page">
      ${examBanner()}
      <a class="btn primary big" href="#/m/${esc(mod.id)}/learn">
        <span>Lernen</span>
        <small>${o.due + o.newToday ? `${o.due} fällig · ${o.newToday} neu` : 'Für heute alles erledigt ✓'}</small>
      </a>
      <div class="grid2">
        <a class="btn secondary" href="#/m/${esc(mod.id)}/exam"><span>Simulation</span><small>${state.settings.examCount} Fragen · ${state.settings.examTimer ? `${state.settings.examTimer} s` : 'ohne Zeit'}</small></a>
        <a class="btn secondary ${weak ? '' : 'disabled'}" href="${weak ? `#/m/${esc(mod.id)}/weak` : '#'}"><span>Schwächen</span><small>${weak ? plural(weak, 'Karte', 'Karten') : 'noch keine'}</small></a>
      </div>

      <section class="card">
        <h3>Fortschritt</h3>
        <div class="stack-bar" role="img" aria-label="Fortschritt">
          <div class="seg mastered" style="width:${pct(o.counts.mastered)}%"></div>
          <div class="seg known" style="width:${pct(o.counts.known)}%"></div>
          <div class="seg learning" style="width:${pct(o.counts.learning)}%"></div>
        </div>
        <ul class="legend">
          <li><i class="dot mastered"></i>Gemeistert <strong>${o.counts.mastered}</strong></li>
          <li><i class="dot known"></i>Gelernt <strong>${o.counts.known}</strong></li>
          <li><i class="dot learning"></i>In Arbeit <strong>${o.counts.learning}</strong></li>
          <li><i class="dot new"></i>Neu <strong>${o.counts.new}</strong></li>
        </ul>
        <p class="muted small">Heute: ${today.answered} Antworten${today.answered ? `, ${Math.round(today.correct / today.answered * 100)} % richtig` : ''} · Morgen fällig: ${o.tomorrow} · nächste 7 Tage: ${o.week}</p>
      </section>

      <section class="card">
        <h3>Kartensätze</h3>
        ${mod.decks.map(d => `<label class="deck">
          <input type="checkbox" data-deck="${esc(d.id)}" ${state.disabledDecks[d.id] ? '' : 'checked'}>
          <span><strong>${esc(d.title)}</strong><br><span class="muted small">${plural(d.cards.length, 'Karte', 'Karten')} · ${esc(CATEGORY_LABELS[d.category] || '')}</span></span>
        </label>`).join('')}
        <a class="link" href="#/m/${esc(mod.id)}/cards">Alle Karten ansehen ›</a>
      </section>
    </div>`;
  root.querySelectorAll('[data-deck]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) delete state.disabledDecks[cb.dataset.deck];
    else state.disabledDecks[cb.dataset.deck] = true;
    save();
    renderModule(mod);
  }));
}

function startLearn(mod) {
  const items = buildLearnSession(mod);
  if (!items.length) {
    root.innerHTML = `${header(mod.title, `#/m/${mod.id}`)}
      <div class="page center"><div class="card"><h2>Alles erledigt 🎉</h2>
      <p class="muted">Für heute ist nichts mehr fällig. Morgen geht es weiter – oder trainiere jetzt deine Schwachstellen bzw. mach eine Prüfungssimulation.</p>
      <a class="btn primary" href="#/m/${esc(mod.id)}">Zurück</a></div></div>`;
    return;
  }
  startQuiz(mod, 'learn', items);
}

function startQuiz(mod, mode, items) {
  if (!items.length) return go(`#/m/${mod.id}`);
  requestPersistence();
  activeQuiz = runQuiz(root, { mod, mode, items, onDone: r => { activeQuiz = null; renderResult(mod, r); } });
}

function renderResult(mod, r) {
  const pct = r.answered ? Math.round(r.correct / r.answered * 100) : 0;
  const mistakes = [...r.mistakes.values()];
  const more = r.mode === 'learn' && buildLearnSession(mod).length;
  const titles = { learn: 'Einheit beendet', weak: 'Schwachstellen-Training', exam: 'Ergebnis der Simulation' };
  root.innerHTML = `${header(titles[r.mode], `#/m/${mod.id}`)}
    <div class="page">
      <section class="card center">
        <p class="score ${pct >= 80 ? 'ok' : pct >= 60 ? 'mid' : 'bad'}">${pct} %</p>
        <p class="muted">${r.correct} von ${r.answered} richtig · ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')} min</p>
        ${r.mode === 'exam' && mistakes.length ? '<p class="small muted">Deine Fehler kommen automatisch in die nächste Lerneinheit.</p>' : ''}
      </section>
      ${mistakes.length ? `<section class="card"><h3>Fehler</h3><ul class="mistakes">
        ${mistakes.map(({ item: { card }, chosen }) => `<li><strong>${esc(card.term)}</strong> = ${esc(card.answer)}
          ${chosen ? `<br><span class="muted small">Deine Wahl: ${esc(chosen)}</span>` : ''}</li>`).join('')}
      </ul></section>` : ''}
      <div class="grid2">
        <a class="btn secondary" href="#/m/${esc(mod.id)}">Übersicht</a>
        ${more ? `<a class="btn primary" href="#/m/${esc(mod.id)}/learn" data-again>Weiter lernen</a>`
          : r.mode !== 'learn' ? `<a class="btn primary" href="#/m/${esc(mod.id)}/${r.mode}" data-again>Nochmal</a>` : ''}
      </div>
    </div>`;
  // Gleicher Hash -> kein hashchange, daher manuell neu starten.
  root.querySelector('[data-again]')?.addEventListener('click', e => {
    if (location.hash === e.currentTarget.getAttribute('href')) { e.preventDefault(); route(); }
  });
}

function renderCards(mod) {
  const labels = { new: 'Neu', learning: 'In Arbeit', known: 'Gelernt', mastered: 'Gemeistert' };
  root.innerHTML = `${header('Alle Karten', `#/m/${mod.id}`)}
    <div class="page">
      <input class="search" type="search" placeholder="Suchen …" autocomplete="off">
      <div class="chips">
        <button class="chip active" data-cat="">Alle</button>
        ${[...new Set(mod.cards.map(c => c.category))].map(c => `<button class="chip" data-cat="${esc(c)}">${esc(CATEGORY_LABELS[c] || c)}</button>`).join('')}
      </div>
      <ul class="card-list"></ul>
    </div>`;
  const list = root.querySelector('.card-list');
  const search = root.querySelector('.search');
  let cat = '';
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const cards = mod.cards.filter(c => (!cat || c.category === cat) &&
      (!q || `${c.term} ${c.answer} ${(c.alt || []).join(' ')}`.toLowerCase().includes(q)));
    list.innerHTML = cards.slice(0, 300).map(c => {
      const st = status(`${c.id}|f`);
      return `<li><div><strong>${esc(c.term)}</strong><br>${esc(c.answer)}${c.alt?.length ? `<span class="muted"> · ${esc(c.alt.join(', '))}</span>` : ''}${c.note ? `<br><span class="muted small">${esc(c.note)}</span>` : ''}</div>
        <span class="tag tag-${st}">${labels[st]}</span></li>`;
    }).join('') + (cards.length > 300 ? `<li class="muted">… und ${cards.length - 300} weitere</li>` : '');
  };
  search.addEventListener('input', draw);
  root.querySelector('.chips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    cat = b.dataset.cat;
    root.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
    draw();
  });
  draw();
}

function renderSettings() {
  const s = state.settings;
  root.innerHTML = `${header('Einstellungen', history.length > 1 ? 'javascript:history.back()' : '#/')}
    <div class="page">
      <section class="card form">
        <h3>Test</h3>
        <label>Testdatum<input type="date" name="examDate" value="${esc(s.examDate)}"></label>
        <p class="muted small">Wiederholungen werden so geplant, dass jede Karte vor dem Test noch einmal drankommt.</p>
        <label>Fragen pro Simulation<input type="number" name="examCount" min="5" max="200" value="${s.examCount}"></label>
        <label>Zeit pro Frage in der Simulation (Sek., 0 = aus)<input type="number" name="examTimer" min="0" max="120" value="${s.examTimer}"></label>
      </section>
      <section class="card form">
        <h3>Lernen</h3>
        <label>Neue Karten pro Tag<input type="number" name="newPerDay" min="0" max="500" value="${s.newPerDay}"></label>
        <label>Antwortmöglichkeiten<input type="number" name="options" min="2" max="8" value="${s.options}"></label>
        <label>Zeitlimit beim Lernen (Sek., 0 = aus)<input type="number" name="timer" min="0" max="120" value="${s.timer}"></label>
        <label>Ziel-Erinnerungsquote<select name="retention">
          ${[0.85, 0.9, 0.93, 0.95].map(v => `<option value="${v}" ${s.retention === v ? 'selected' : ''}>${Math.round(v * 100)} %${v === 0.9 ? ' (empfohlen)' : v > 0.9 ? ' (mehr Wiederholungen)' : ' (weniger Wiederholungen)'}</option>`).join('')}
        </select></label>
        <label class="check"><input type="checkbox" name="reverse" ${s.reverse ? 'checked' : ''}> Auch umgekehrt abfragen (Bedeutung → Begriff)</label>
        <label class="check"><input type="checkbox" name="autoAdvance" ${s.autoAdvance ? 'checked' : ''}> Bei richtiger Antwort automatisch weiter</label>
      </section>
      <section class="card form">
        <h3>Daten</h3>
        <p class="muted small">Dein Fortschritt liegt nur auf diesem Gerät. Tipp: App zum Home-Bildschirm hinzufügen und ab und zu ein Backup speichern.</p>
        <div class="row">
          <button class="btn secondary" data-act="export">Backup speichern</button>
          <label class="btn secondary">Backup laden<input type="file" accept="application/json,.json" hidden data-act="import"></label>
        </div>
        <button class="btn danger" data-act="reset">Fortschritt zurücksetzen</button>
      </section>
    </div>`;

  root.querySelectorAll('input[name], select[name]').forEach(el => el.addEventListener('change', () => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number' || el.tagName === 'SELECT') v = Number(el.value);
    else v = el.value;
    if (el.type === 'number') {
      v = Math.min(Number(el.max), Math.max(Number(el.min), Math.round(v) || 0));
      el.value = v;
    }
    s[el.name] = v;
    save();
  }));
  root.querySelector('[data-act="export"]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sprachtrainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  root.querySelector('[data-act="import"]').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.items || !data.settings) throw new Error('Kein gültiges Backup');
      if (confirm('Aktuellen Fortschritt durch das Backup ersetzen?')) {
        replaceState(data);
        alert('Backup geladen.');
        renderSettings();
      }
    } catch (err) {
      alert(`Backup konnte nicht geladen werden: ${err.message}`);
    }
  });
  root.querySelector('[data-act="reset"]').addEventListener('click', () => {
    if (confirm('Wirklich den gesamten Lernfortschritt löschen?')) {
      resetProgress();
      alert('Fortschritt gelöscht.');
    }
  });
}

let loadedModules = [];

loadModules()
  .then(mods => {
    loadedModules = mods;
    window.addEventListener('hashchange', route);
    route();
  })
  .catch(err => {
    root.innerHTML = `<div class="page"><div class="card"><h2>Fehler beim Laden</h2><p class="muted">${esc(err.message)}</p></div></div>`;
  });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
