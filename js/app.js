import { loadModules, reloadModules, findModule, parsePack, CATEGORY_LABELS } from './data.js';
import { state, save, streak, dayKey, replaceState, resetProgress, requestPersistence, loadPacks, savePacks } from './store.js';
import {
  overview, buildLearnSession, buildExamSession, buildRepeatSession, buildLagerSession, endlessBatch,
  weakItems, cardLager, daysUntilExam, LAGER,
} from './srs.js';
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
    case 'repeat': return startQuiz(mod, 'repeat', buildRepeatSession(mod));
    case 'endless': return startQuiz(mod, 'endless', [], exclude => endlessBatch(mod, exclude));
    case 'lager': return startLager(mod, Number(parts[3]));
    case 'cards': return renderCards(mod);
    default: return renderModule(mod);
  }
}

// Ohne accept-Filter, weil iOS JSON-Dateien sonst teils ausgraut; der Inhalt wird beim Import geprüft.
const importButton = (label, cls = 'secondary') =>
  `<label class="btn ${cls}">${label}<input type="file" hidden data-import></label>`;

async function importFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert('Die Datei konnte nicht gelesen werden. Bitte die .json-Kartendatei auswählen.');
    return;
  }
  try {
    if (data.type === 'sprachtrainer-pack') {
      const pack = parsePack(data);
      const packs = loadPacks();
      packs[pack.module.id] = pack;
      savePacks(packs);
      requestPersistence();
      loadedModules = await reloadModules();
      const n = pack.decks.reduce((sum, d) => sum + d.cards.length, 0);
      alert(`${n} Karten importiert: ${pack.decks.map(d => d.title).join(', ')}.`);
      const target = `#/m/${pack.module.id}`;
      if (location.hash === target) route(); else go(target);
    } else if (data.items && data.settings) {
      if (!confirm('Backup laden? Dein aktueller Fortschritt wird dadurch ersetzt.')) return;
      const { packs, ...progress } = data;
      if (packs) savePacks(packs);
      replaceState(progress);
      loadedModules = await reloadModules();
      alert('Backup geladen.');
      route();
    } else {
      throw new Error('Unbekanntes Dateiformat. Erwartet wird eine Kartendatei oder ein Backup.');
    }
  } catch (err) {
    alert(err.name === 'QuotaExceededError' ? 'Nicht genug Speicherplatz im Browser.' : err.message);
  }
}

root.addEventListener('change', e => {
  if (!e.target.matches('[data-import]')) return;
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importFile(file);
});

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
        const started = o.total - o.lager[0];
        const stats = m.cards.length
          ? `<strong>${o.due}</strong> fällig · <strong>${o.newToday}</strong> neu · ${started}/${o.total} begonnen`
          : 'Noch keine Karten – Kartendatei importieren';
        return `<a class="card module" href="#/m/${esc(m.id)}">
          <div class="module-head">
            <div><h2>${esc(m.title)}</h2><p class="muted">${esc(m.subtitle || '')}</p></div>
            ${m.priority ? '<span class="tag tag-prio">Priorität</span>' : ''}
          </div>
          <p class="module-stats">${stats}</p>
        </a>`;
      }).join('')}
      <div class="card placeholder"><h2>Weitere Sprachen</h2><p class="muted">Kommen später dazu – mit eigenen Schwerpunkten.</p></div>
    </div>`;
}

function renderEmptyModule(mod) {
  root.innerHTML = `${header(mod.title, '#/')}
    <div class="page">
      <section class="card">
        <h2>Noch keine Karten</h2>
        <p class="muted">Importiere deine Kartendatei (.json). Die Karten werden nur auf diesem Gerät gespeichert.</p>
        <p class="muted small">So geht’s: Datei in der Dateien-App speichern (z. B. aus iCloud Drive oder per AirDrop), dann hier auswählen.</p>
        ${importButton('Kartendatei auswählen', 'primary')}
      </section>
    </div>`;
}

const fmtMinutes = ms => {
  const min = Math.round((ms || 0) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};

function lagerSection(mod, o) {
  const base = `#/m/${esc(mod.id)}/lager/`;
  return `<section class="card">
    <h3>Lager</h3>
    <div class="lager-row">
      ${LAGER.map(l => `<a class="lager l${l.n} ${o.lager[l.n] ? '' : 'empty'}" href="${o.lager[l.n] ? base + l.n : '#'}"
          aria-label="${esc(l.name)}: ${o.lager[l.n]} Karten">
        <strong>${o.lager[l.n]}</strong><span>${esc(l.name)}</span>
      </a>`).join('')}
    </div>
    <p class="muted small">Neu (noch nicht gelernt): <strong>${o.lager[0]}</strong> · Tippe auf ein Lager, um genau diese Karten zu trainieren.</p>
    <details class="small muted"><summary>Was bedeuten die Lager?</summary>
      <ul class="plain">${LAGER.map(l => `<li><strong>${l.n} ${esc(l.name)}</strong> – ${esc(l.hint)}</li>`).join('')}</ul>
      Eine Karte steht im Lager ihrer schwächeren Richtung. Richtige Antworten schieben sie nach oben, Fehler zurück nach unten.
    </details>
  </section>`;
}

function statsSection(mod, o) {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const st = state.days[dayKey(d.getTime())]?.[mod.id] || { answered: 0, correct: 0, ms: 0 };
    days.push({ d, ...st });
  }
  const max = Math.max(10, ...days.map(d => d.answered));
  const today = days[days.length - 1];
  const total = Object.values(state.days).reduce((acc, day) => {
    const st = day[mod.id];
    if (st) { acc.answered += st.answered; acc.correct += st.correct; acc.ms += st.ms || 0; }
    return acc;
  }, { answered: 0, correct: 0, ms: 0 });
  const pct = st => (st.answered ? `${Math.round(st.correct / st.answered * 100)} %` : '–');
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return `<section class="card">
    <h3>Statistik heute</h3>
    <div class="tiles">
      <div><strong>${today.answered}</strong><span>Antworten</span></div>
      <div><strong>${pct(today)}</strong><span>richtig</span></div>
      <div><strong>${fmtMinutes(today.ms)}</strong><span>Lernzeit</span></div>
    </div>
    <p class="muted small chart-title">Verlauf: Antworten pro Tag (letzte 14 Tage)</p>
    <div class="day-chart" role="img" aria-label="Antworten pro Tag in den letzten 14 Tagen">
      ${days.map((d, i) => `<button class="day-col" data-tip="${d.d.getDate()}.${d.d.getMonth() + 1}.: ${d.answered} Antworten, ${pct(d)} richtig, ${fmtMinutes(d.ms)}">
        <span class="day-bar" style="height:${d.answered ? Math.max(4, d.answered / max * 100) : 0}%"></span>
        <span class="day-label">${i % 2 === 1 ? wd[d.d.getDay()] : ''}</span>
      </button>`).join('')}
    </div>
    <p class="muted small tip" aria-live="polite">Tippe auf einen Balken für Details.</p>
    <p class="muted small">Gesamt: ${total.answered} Antworten · ${pct(total)} richtig · ${fmtMinutes(total.ms)} · 🔥 ${plural(streak(), 'Tag', 'Tage')} in Folge</p>
    <p class="muted small">Morgen fällig: ${o.tomorrow} · nächste 7 Tage: ${o.week}</p>
  </section>`;
}

function renderModule(mod) {
  if (!mod.cards.length) return renderEmptyModule(mod);
  const o = overview(mod);
  const weak = weakItems(mod).length;
  const id = esc(mod.id);
  const todo = o.due + o.newToday;
  root.innerHTML = `${header(mod.title, '#/')}
    <div class="page">
      ${examBanner()}
      ${todo ? `<a class="btn primary big" href="#/m/${id}/learn">
          <span>Lernen</span><small>${o.due} fällig · ${o.newToday} neu</small></a>`
        : `<a class="btn primary big done" href="#/m/${id}/repeat">
          <span>Heute geschafft ✓</span><small>Heutige ${plural(o.reviewedToday, 'Karte', 'Karten')} nochmal üben</small></a>`}
      <a class="btn secondary endless" href="#/m/${id}/endless">
        <span>∞ Endlos lernen</span><small>So lange du willst – mit „Fertig“-Knopf</small>
      </a>
      <div class="grid2">
        <a class="btn secondary" href="#/m/${id}/exam"><span>Simulation</span><small>${state.settings.examCount} Fragen · ${state.settings.examTimer ? `${state.settings.examTimer} s` : 'ohne Zeit'}</small></a>
        <a class="btn secondary ${weak ? '' : 'disabled'}" href="${weak ? `#/m/${id}/weak` : '#'}"><span>Schwächen</span><small>${weak ? plural(weak, 'Karte', 'Karten') : 'noch keine'}</small></a>
      </div>
      ${todo && o.reviewedToday ? `<a class="link center" href="#/m/${id}/repeat">Heute gelernte Karten nochmal üben (${o.reviewedToday}) ›</a>` : ''}

      ${lagerSection(mod, o)}
      ${statsSection(mod, o)}

      <section class="card">
        <h3>Kartensätze</h3>
        ${mod.decks.map(d => `<label class="deck">
          <input type="checkbox" data-deck="${esc(d.id)}" ${state.disabledDecks[d.id] ? '' : 'checked'}>
          <span><strong>${esc(d.title)}</strong><br><span class="muted small">${plural(d.cards.length, 'Karte', 'Karten')} · ${esc(CATEGORY_LABELS[d.category] || '')}</span></span>
        </label>`).join('')}
        <a class="link" href="#/m/${id}/cards">Alle Karten ansehen ›</a>
      </section>
    </div>`;
  root.querySelectorAll('[data-deck]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) delete state.disabledDecks[cb.dataset.deck];
    else state.disabledDecks[cb.dataset.deck] = true;
    save();
    renderModule(mod);
  }));
  const tip = root.querySelector('.tip');
  root.querySelectorAll('.day-col').forEach(col => {
    const showTip = () => {
      root.querySelectorAll('.day-col').forEach(c => c.classList.toggle('active', c === col));
      tip.textContent = col.dataset.tip;
    };
    col.addEventListener('click', showTip);
    col.addEventListener('mouseenter', showTip);
  });
}

function startLearn(mod) {
  const items = buildLearnSession(mod);
  if (!items.length) return go(`#/m/${mod.id}`);
  startQuiz(mod, 'learn', items);
}

function startLager(mod, n) {
  const items = buildLagerSession(mod, n);
  if (!items.length) return go(`#/m/${mod.id}`);
  requestPersistence();
  activeQuiz = runQuiz(root, { mod, mode: 'lager', items, onDone: r => { activeQuiz = null; renderResult(mod, { ...r, lager: n }); } });
}

function startQuiz(mod, mode, items, refill) {
  if (!items.length && !refill) return go(`#/m/${mod.id}`);
  requestPersistence();
  activeQuiz = runQuiz(root, { mod, mode, items, refill, onDone: r => { activeQuiz = null; renderResult(mod, r); } });
}

function renderResult(mod, r) {
  const pct = r.answered ? Math.round(r.correct / r.answered * 100) : 0;
  const mistakes = [...r.mistakes.values()];
  const id = esc(mod.id);
  const titles = {
    learn: 'Einheit beendet', endless: 'Endlos-Lernen beendet', repeat: 'Wiederholung beendet',
    lager: `Lager ${r.lager || ''} trainiert`, weak: 'Schwachstellen-Training', exam: 'Ergebnis der Simulation',
  };
  const more = r.mode === 'learn' && buildLearnSession(mod).length;
  const again = {
    learn: more ? [`#/m/${id}/learn`, 'Weiter lernen'] : [`#/m/${id}/repeat`, 'Nochmal üben'],
    endless: [`#/m/${id}/endless`, 'Weiter lernen'],
    repeat: [`#/m/${id}/repeat`, 'Nochmal üben'],
    lager: [`#/m/${id}/lager/${r.lager}`, 'Nochmal'],
    weak: [`#/m/${id}/weak`, 'Nochmal'],
    exam: [`#/m/${id}/exam`, 'Nochmal'],
  }[r.mode];
  root.innerHTML = `${header(titles[r.mode], `#/m/${id}`)}
    <div class="page">
      <section class="card center">
        <p class="score ${pct >= 80 ? 'ok' : pct >= 60 ? 'mid' : 'bad'}">${r.answered ? `${pct} %` : '–'}</p>
        <p class="muted">${r.correct} von ${r.answered} richtig · ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')} min</p>
        ${r.mode === 'exam' && mistakes.length ? '<p class="small muted">Deine Fehler kommen automatisch in die nächste Lerneinheit.</p>' : ''}
        ${r.mode === 'learn' && !more ? '<p class="small muted">Tagespensum geschafft! Du kannst die heutigen Karten beliebig oft wiederholen oder endlos weiterlernen.</p>' : ''}
      </section>
      ${mistakes.length ? `<section class="card"><h3>Fehler</h3><ul class="mistakes">
        ${mistakes.map(({ item: { card }, chosen }) => `<li><strong>${esc(card.term)}</strong> = ${esc(card.answer)}
          ${chosen ? `<br><span class="muted small">Deine Wahl: ${esc(chosen)}</span>` : ''}</li>`).join('')}
      </ul></section>` : ''}
      <div class="grid2">
        <a class="btn secondary" href="#/m/${id}">Übersicht</a>
        <a class="btn primary" href="${again[0]}" data-again>${again[1]}</a>
      </div>
      ${r.mode === 'learn' && !more ? `<a class="btn secondary" href="#/m/${id}/endless">∞ Endlos weiterlernen</a>` : ''}
    </div>`;
  // Gleicher Hash -> kein hashchange, daher manuell neu starten.
  root.querySelector('[data-again]')?.addEventListener('click', e => {
    if (location.hash === e.currentTarget.getAttribute('href')) { e.preventDefault(); route(); }
  });
}

function renderCards(mod) {
  root.innerHTML = `${header('Alle Karten', `#/m/${mod.id}`)}
    <div class="page">
      <input class="search" type="search" placeholder="Suchen …" autocomplete="off">
      <div class="chips" data-filter="cat">
        <button class="chip active" data-v="">Alle</button>
        ${[...new Set(mod.cards.map(c => c.category))].map(c => `<button class="chip" data-v="${esc(c)}">${esc(CATEGORY_LABELS[c] || c)}</button>`).join('')}
      </div>
      <div class="chips" data-filter="lager">
        <button class="chip active" data-v="">Alle Lager</button>
        <button class="chip" data-v="0">Neu</button>
        ${LAGER.map(l => `<button class="chip" data-v="${l.n}">${l.n} ${esc(l.name)}</button>`).join('')}
      </div>
      <p class="muted small count"></p>
      <ul class="card-list"></ul>
    </div>`;
  const list = root.querySelector('.card-list');
  const search = root.querySelector('.search');
  const filter = { cat: '', lager: '' };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const cards = mod.cards.filter(c => (!filter.cat || c.category === filter.cat) &&
      (filter.lager === '' || cardLager(c) === Number(filter.lager)) &&
      (!q || `${c.term} ${c.answer} ${(c.alt || []).join(' ')}`.toLowerCase().includes(q)));
    root.querySelector('.count').textContent = plural(cards.length, 'Karte', 'Karten');
    list.innerHTML = cards.slice(0, 300).map(c => {
      const l = cardLager(c);
      return `<li><div><strong>${esc(c.term)}</strong><br>${esc(c.answer)}${c.alt?.length ? `<span class="muted"> · ${esc(c.alt.join(', '))}</span>` : ''}${c.note ? `<br><span class="muted small">${esc(c.note)}</span>` : ''}</div>
        <span class="tag lager-tag l${l}">${l ? `${l} ${esc(LAGER[l - 1].name)}` : 'Neu'}</span></li>`;
    }).join('') + (cards.length > 300 ? `<li class="muted">… und ${cards.length - 300} weitere</li>` : '');
  };
  search.addEventListener('input', draw);
  root.querySelectorAll('[data-filter]').forEach(row => row.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    filter[row.dataset.filter] = b.dataset.v;
    row.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
    draw();
  }));
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
        <label class="check"><input type="checkbox" name="reverse" ${s.reverse ? 'checked' : ''}> In beide Richtungen abfragen (auch Bedeutung → Begriff)</label>
        <label class="check"><input type="checkbox" name="autoAdvance" ${s.autoAdvance ? 'checked' : ''}> Bei richtiger Antwort automatisch weiter</label>
      </section>
      <section class="card form">
        <h3>Kartensätze</h3>
        ${Object.values(loadPacks()).map(p => `<div class="deck">
          <span class="grow"><strong>${esc(p.module.title)}</strong><br>
            <span class="muted small">${p.decks.map(d => `${esc(d.title)} (${d.cards.length})`).join(' · ')}</span></span>
          <button class="btn ghost small-btn" data-remove-pack="${esc(p.module.id)}">Entfernen</button>
        </div>`).join('') || '<p class="muted small">Noch keine Kartendatei importiert.</p>'}
        <p class="muted small">Importierte Karten bleiben nur auf diesem Gerät. Eine neue Version derselben Datei ersetzt die alte, dein Fortschritt bleibt erhalten.</p>
        ${importButton('Kartendatei importieren')}
      </section>
      <section class="card form">
        <h3>Daten</h3>
        <p class="muted small">Fortschritt und Karten liegen nur auf diesem Gerät. Tipp: App zum Home-Bildschirm hinzufügen und ab und zu ein Backup speichern – es enthält auch die Karten.</p>
        <div class="row">
          <button class="btn secondary" data-act="export">Backup speichern</button>
          ${importButton('Backup laden')}
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
    const blob = new Blob([JSON.stringify({ ...state, packs: loadPacks() })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sprachtrainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  root.querySelectorAll('[data-remove-pack]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Kartensatz von diesem Gerät entfernen? Dein Lernfortschritt bleibt gespeichert.')) return;
    const packs = loadPacks();
    delete packs[btn.dataset.removePack];
    savePacks(packs);
    loadedModules = await reloadModules();
    renderSettings();
  }));
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
