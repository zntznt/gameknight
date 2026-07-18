// app.js — Gameknight orchestration.
// Flow: collections → preference flowchart (live narrowing) → hard constraints → result.

import { loadData, poolFor, applyFilters, questionPredicate } from './data.js';
import { QUESTIONS } from './questions.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
// Like el() but for untrusted strings (game names, owner/collection labels from
// BGG). Uses textContent so a name like "Wits & Wagers" or a crafted
// "<img onerror=...>" renders literally instead of as HTML.
const txt = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  data: null,
  step: 'loading',
  selected: new Set(),
  mode: 'union', // 'union' | 'intersection'
  answers: {}, // questionId -> [optionId]
  prefIndex: 0,
  constraints: { players: null, playerFit: 'rec', wLo: 0, wHi: 99, maxTime: null, minAge: null },
};

const stage = () => $('#stage');
const liveEl = () => $('#live');

// --- derived sets -----------------------------------------------------------
function basePool() {
  return poolFor(state.data, [...state.selected], state.mode);
}
function prefPredicates(upToIndex = QUESTIONS.length) {
  return QUESTIONS.slice(0, upToIndex).map((q) => questionPredicate(q, state.answers[q.id]));
}
function afterPrefs() {
  return applyFilters(basePool(), prefPredicates());
}
function constraintPredicates() {
  const c = state.constraints;
  const preds = [];
  if (c.players) preds.push((g) => fitsPlayers(g, c.players, c.playerFit));
  // Complexity buckets are half-open [lo, hi). Unknown weight (0) always passes.
  if (c.wLo > 0 || c.wHi < 99)
    preds.push((g) => !g.weight || (g.weight >= c.wLo && g.weight < c.wHi));
  if (c.maxTime) preds.push((g) => {
    const t = g.playTime || g.maxTime || g.minTime || 0;
    return !t || t <= c.maxTime;
  });
  if (c.minAge) preds.push((g) => !g.minAge || g.minAge <= c.minAge);
  return preds;
}
function finalGames() {
  return applyFilters(afterPrefs(), constraintPredicates());
}

// Does a game play well at N players?
//   'supported' — N is within the box's min–max range.
//   'rec'       — the community's suggested-players poll recommends N.
//   'best'      — the poll calls N a best count.
// The "8" chip means "8 or more". Games without poll data fall back to the box.
function fitsPlayers(g, n, mode) {
  const atLeast = n >= 8;
  const inBox = atLeast ? g.maxPlayers >= 8 : g.minPlayers <= n && g.maxPlayers >= n;
  if (mode === 'supported') return inBox;
  const arr = mode === 'best' ? g.bestPlayers : g.recPlayers;
  if (!g.pollVotes || !Array.isArray(arr) || !arr.length) return inBox; // no poll → box range
  return atLeast ? arr.some((c) => c >= 8) : arr.includes(n);
}

// Is the chosen player count a best / recommended count for this game?
function isBestAt(g, n) {
  if (!n || !g.pollVotes || !Array.isArray(g.bestPlayers)) return false;
  return n >= 8 ? g.bestPlayers.some((c) => c >= 8) : g.bestPlayers.includes(n);
}
function isRecAt(g, n) {
  if (!n || !g.pollVotes || !Array.isArray(g.recPlayers)) return false;
  return n >= 8 ? g.recPlayers.some((c) => c >= 8) : g.recPlayers.includes(n);
}

// Fit tier for the chosen player count: best (3) > recommended (2) > supported /
// no-poll (1). No player count chosen → neutral (0), so ordering falls to rating.
function fitTier(g) {
  const n = state.constraints.players;
  if (!n) return 0;
  if (isBestAt(g, n)) return 3;
  if (isRecAt(g, n)) return 2;
  return 1;
}

// Rank by how well the game fits the table, then by BGG rating.
function sortByFit(games) {
  return games.slice().sort((a, b) => fitTier(b) - fitTier(a) || (b.rating || 0) - (a.rating || 0));
}

// Compress [1,2,3,5] → "1–3, 5" for the "best at N" badge.
function formatCounts(arr) {
  const a = [...new Set(arr)].sort((x, y) => x - y);
  const runs = [];
  let start = null;
  let prev = null;
  for (const n of a) {
    if (start === null) start = prev = n;
    else if (n === prev + 1) prev = n;
    else {
      runs.push([start, prev]);
      start = prev = n;
    }
  }
  if (start !== null) runs.push([start, prev]);
  return runs.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`)).join(', ');
}

// --- thumbnails with graceful fallback --------------------------------------
const TILE_COLORS = ['#7c5cff', '#2ec4b6', '#ff6b6b', '#ffb703', '#4cc9f0', '#f072b6', '#90be6d'];
function thumb(game, size = 'sm') {
  const wrap = el('div', `thumb thumb--${size}`);
  const initials = (game.name || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 2).toUpperCase() || '?';
  const color = TILE_COLORS[Math.abs(game.id || 0) % TILE_COLORS.length];
  const fallback = () => {
    wrap.innerHTML = '';
    wrap.style.background = color;
    wrap.appendChild(el('span', 'thumb__ini', initials));
  };
  if (game.thumbnail) {
    const img = el('img');
    img.loading = 'lazy';
    img.alt = game.name;
    img.src = game.thumbnail;
    img.onerror = fallback;
    wrap.appendChild(img);
  } else {
    fallback();
  }
  wrap.title = game.name;
  return wrap;
}

// --- the persistent "what remains" panel ------------------------------------
function renderLive() {
  const wrap = liveEl();
  wrap.innerHTML = '';
  if (state.step === 'collections' || state.step === 'loading' || state.step === 'setup' || state.step === 'error') {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const games = state.step === 'result' || state.step === 'constraints' ? finalGames() : afterPrefs();
  const total = basePool().length;

  const head = el('div', 'live__head');
  head.appendChild(el('div', 'live__count', `<strong>${games.length}</strong> <span>of ${total} games remain</span>`));
  wrap.appendChild(head);

  const strip = el('div', 'live__strip');
  if (games.length === 0) {
    strip.appendChild(el('div', 'live__empty', 'Nothing fits — loosen a preference or constraint.'));
  } else {
    sortByFit(games).forEach((g) => strip.appendChild(thumb(g, 'sm')));
  }
  wrap.appendChild(strip);
}

// --- steps ------------------------------------------------------------------
function go(step) {
  state.step = step;
  render();
}
function render() {
  renderLive();
  const s = stage();
  s.innerHTML = '';
  ({
    loading: renderLoading,
    setup: renderSetup,
    error: renderError,
    collections: renderCollections,
    prefs: renderPrefs,
    constraints: renderConstraints,
    result: renderResult,
  }[state.step] || renderLoading)(s);
}

function renderLoading(s) {
  s.appendChild(el('div', 'card center', '<div class="spinner"></div><p>Loading the shelf…</p>'));
}

function renderError(s, msg) {
  s.appendChild(el('div', 'card', `<h2>Something went wrong</h2><p class="muted">${msg || state._error || ''}</p>`));
}

function renderSetup(s) {
  const card = el('div', 'card');
  card.innerHTML = `
    <h2>Welcome to Gameknight ♞</h2>
    <p>No collections are loaded yet. To fill the shelf:</p>
    <ol class="steps">
      <li>Edit <code>data/collections.config.json</code> with your friends' BoardGameGeek usernames.</li>
      <li>Run the <strong>Fetch BGG collections</strong> GitHub Action (Actions tab → Run workflow).</li>
      <li>It commits a fresh <code>data/games.json</code> and this page fills up automatically.</li>
    </ol>
    <p class="muted">Right now you're seeing bundled sample data so you can try the flow.</p>`;
  const btn = el('button', 'btn btn--primary', 'Try it with sample data →');
  btn.onclick = () => go('collections');
  card.appendChild(btn);
  s.appendChild(card);
}

function renderCollections(s) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, 'Whose shelves are we raiding?'));
  card.appendChild(el('p', 'muted', 'Pick one or several collections.'));

  const list = el('div', 'collections');
  state.data.collections.forEach((c) => {
    const count = state.data.games.filter((g) => (g.owners || []).includes(c.id)).length;
    const row = el('label', 'collection');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(c.id);
    cb.onchange = () => {
      cb.checked ? state.selected.add(c.id) : state.selected.delete(c.id);
      updateColUI();
    };
    row.appendChild(cb);
    const labelWrap = txt('span', 'collection__label', c.label + ' ');
    labelWrap.appendChild(txt('span', 'muted', `· ${count} games`));
    row.appendChild(labelWrap);
    list.appendChild(row);
  });
  card.appendChild(list);

  const modeWrap = el('div', 'mode');
  modeWrap.appendChild(el('span', 'mode__label', 'When multiple are picked, include games…'));
  const seg = el('div', 'segmented');
  [
    ['union', 'anyone owns'],
    ['intersection', 'everyone owns'],
  ].forEach(([val, label]) => {
    const b = el('button', 'seg' + (state.mode === val ? ' seg--on' : ''), label);
    b.onclick = () => {
      state.mode = val;
      updateColUI();
    };
    seg.appendChild(b);
  });
  modeWrap.appendChild(seg);
  card.appendChild(modeWrap);

  const foot = el('div', 'card__foot');
  const startBtn = el('button', 'btn btn--primary', 'Start →');
  startBtn.onclick = () => {
    state.prefIndex = 0;
    go('prefs');
  };
  const poolNote = el('span', 'muted pool-note');
  foot.appendChild(poolNote);
  foot.appendChild(startBtn);
  card.appendChild(foot);
  s.appendChild(card);

  function updateColUI() {
    const n = basePool().length;
    poolNote.textContent = `${n} game${n === 1 ? '' : 's'} in play`;
    startBtn.disabled = state.selected.size === 0;
  }
  updateColUI();
}

function renderPrefs(s) {
  const q = QUESTIONS[state.prefIndex];
  const answered = prefPredicates(state.prefIndex); // filters from PREVIOUS questions
  const context = applyFilters(basePool(), answered);
  const selected = new Set(state.answers[q.id] || []);

  const card = el('div', 'card');
  const prog = el('div', 'progress');
  QUESTIONS.forEach((_, i) =>
    prog.appendChild(el('span', 'progress__dot' + (i < state.prefIndex ? ' done' : i === state.prefIndex ? ' on' : '')))
  );
  card.appendChild(prog);
  card.appendChild(el('div', 'kicker', `Preference ${state.prefIndex + 1} of ${QUESTIONS.length}`));
  card.appendChild(el('h2', null, q.title));
  if (q.subtitle) card.appendChild(el('p', 'muted', q.subtitle));

  const opts = el('div', 'options');
  q.options.forEach((o) => {
    // live count: how many survive if this option were active alongside prior answers
    const wouldRemain = context.filter((g) => o.match(g)).length;
    const on = selected.has(o.id);
    const b = el('button', 'option' + (on ? ' option--on' : '') + (wouldRemain === 0 ? ' option--empty' : ''));
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    // o.label / o.hint come from questions.js (our own code), so HTML here is safe.
    b.innerHTML = `<span class="option__label">${o.label}</span>${o.hint ? `<span class="option__hint">${o.hint}</span>` : ''}<span class="option__count">${wouldRemain}</span>`;
    b.onclick = () => {
      if (q.type === 'single') {
        state.answers[q.id] = on ? [] : [o.id];
      } else {
        const set = new Set(state.answers[q.id] || []);
        on ? set.delete(o.id) : set.add(o.id);
        state.answers[q.id] = [...set];
      }
      render();
    };
    opts.appendChild(b);
  });
  card.appendChild(opts);

  const foot = el('div', 'card__foot');
  const back = el('button', 'btn btn--ghost', '← Back');
  back.onclick = () => {
    if (state.prefIndex === 0) go('collections');
    else {
      state.prefIndex--;
      render();
    }
  };
  const right = el('div', 'foot-right');
  const skip = el('button', 'btn btn--ghost', 'Doesn’t matter');
  skip.onclick = () => {
    state.answers[q.id] = [];
    next();
  };
  const nextBtn = el('button', 'btn btn--primary', state.prefIndex === QUESTIONS.length - 1 ? 'To constraints →' : 'Next →');
  nextBtn.onclick = next;
  right.appendChild(skip);
  right.appendChild(nextBtn);
  foot.appendChild(back);
  foot.appendChild(right);
  card.appendChild(foot);
  s.appendChild(card);

  function next() {
    if (state.prefIndex === QUESTIONS.length - 1) go('constraints');
    else {
      state.prefIndex++;
      render();
    }
  }
}

function renderConstraints(s) {
  const card = el('div', 'card');
  card.appendChild(el('div', 'kicker', 'The hard limits'));
  card.appendChild(el('h2', null, 'Now the non-negotiables'));
  card.appendChild(el('p', 'muted', 'These filter strictly. Leave any at “Any”.'));

  const c = state.constraints;
  const body = el('div', 'constraints');

  // Player count
  body.appendChild(
    controlRow('Players at the table', playerControl())
  );
  // Complexity
  body.appendChild(controlRow('Complexity (BGG weight)', weightControl()));
  // Time
  body.appendChild(controlRow('Time you’ve got', timeControl()));
  // Age
  body.appendChild(controlRow('Youngest player', ageControl()));

  card.appendChild(body);

  const foot = el('div', 'card__foot');
  const back = el('button', 'btn btn--ghost', '← Back');
  back.onclick = () => {
    state.prefIndex = QUESTIONS.length - 1;
    go('prefs');
  };
  const show = el('button', 'btn btn--primary', 'Show me the games →');
  show.onclick = () => go('result');
  foot.appendChild(back);
  foot.appendChild(show);
  card.appendChild(foot);
  s.appendChild(card);

  function controlRow(label, control) {
    const row = el('div', 'crow');
    row.appendChild(el('div', 'crow__label', label));
    row.appendChild(control);
    return row;
  }

  function chipRow(values, current, onPick, fmt = (v) => v) {
    const wrap = el('div', 'chips');
    const mk = (val, text) => {
      const b = el('button', 'chip' + (current === val ? ' chip--on' : ''), text);
      b.onclick = () => {
        onPick(val);
        render();
      };
      return b;
    };
    wrap.appendChild(mk(null, 'Any'));
    values.forEach((v) => wrap.appendChild(mk(v, fmt(v))));
    return wrap;
  }

  function playerControl() {
    const box = el('div', 'pcontrol');
    box.appendChild(chipRow([1, 2, 3, 4, 5, 6, 7, 8], c.players, (v) => (c.players = v), (v) => (v === 8 ? '8+' : v)));
    if (c.players) {
      const fit = el('div', 'fitsel');
      fit.appendChild(el('span', 'fitsel__label', `How it plays at ${c.players === 8 ? '8+' : c.players}:`));
      const seg = el('div', 'segmented');
      [
        ['best', 'Best'],
        ['rec', 'Recommended'],
        ['supported', 'Box supports'],
      ].forEach(([val, label]) => {
        const b = el('button', 'seg' + (c.playerFit === val ? ' seg--on' : ''), label);
        b.onclick = () => {
          c.playerFit = val;
          render();
        };
        seg.appendChild(b);
      });
      fit.appendChild(seg);
      box.appendChild(fit);
    }
    return box;
  }
  function ageControl() {
    return chipRow([6, 8, 10, 12, 14], c.minAge, (v) => (c.minAge = v), (v) => `${v}+`);
  }
  function timeControl() {
    return chipRow([15, 30, 45, 60, 90, 120, 180], c.maxTime, (v) => (c.maxTime = v), (v) => `≤ ${v}m`);
  }
  function weightControl() {
    // Half-open [lo, hi) buckets on BGG weight (1–5), so none overlap.
    const buckets = [
      { label: 'Any', sub: '', lo: 0, hi: 99 },
      { label: 'Light', sub: 'gateway', lo: 0, hi: 2.0 },
      { label: 'Medium-light', sub: '2.0–2.5', lo: 2.0, hi: 2.5 },
      { label: 'Medium', sub: '2.5–3.0', lo: 2.5, hi: 3.0 },
      { label: 'Heavy', sub: '3.0–4.0', lo: 3.0, hi: 4.0 },
      { label: 'Brain-melter', sub: '4.0+', lo: 4.0, hi: 99 },
    ];
    const wrap = el('div', 'weight');
    buckets.forEach((bk) => {
      const on = c.wLo === bk.lo && c.wHi === bk.hi;
      const b = el('button', 'chip' + (on ? ' chip--on' : ''));
      b.textContent = bk.label;
      if (bk.sub) b.appendChild(el('span', 'chip__sub', bk.sub));
      b.onclick = () => {
        c.wLo = bk.lo;
        c.wHi = bk.hi;
        render();
      };
      wrap.appendChild(b);
    });
    return wrap;
  }
}

function renderResult(s) {
  const games = sortByFit(finalGames());
  const card = el('div', 'card');
  const head = el('div', 'result__head');
  head.appendChild(el('h2', null, games.length ? `${games.length} game${games.length === 1 ? '' : 's'} for the table` : 'Nothing survived'));
  if (games.length > 1) {
    const roll = el('button', 'btn btn--primary', '🎲 Pick for me');
    roll.onclick = () => {
      const pick = games[Math.floor(deterministicRandom() * games.length)];
      highlight(pick.id);
    };
    head.appendChild(roll);
  }
  card.appendChild(head);

  if (!games.length) {
    card.appendChild(el('p', 'muted', 'Every game got filtered out. Step back and relax a want or a constraint.'));
  } else {
    const grid = el('div', 'grid');
    games.forEach((g) => grid.appendChild(gameCard(g)));
    card.appendChild(grid);
  }

  const foot = el('div', 'card__foot');
  const back = el('button', 'btn btn--ghost', '← Tweak constraints');
  back.onclick = () => go('constraints');
  const restart = el('button', 'btn btn--ghost', 'Start over');
  restart.onclick = () => {
    state.answers = {};
    state.prefIndex = 0;
    state.constraints = { players: null, playerFit: 'rec', wLo: 0, wHi: 99, maxTime: null, minAge: null };
    go('collections');
  };
  foot.appendChild(back);
  foot.appendChild(restart);
  card.appendChild(foot);
  s.appendChild(card);

  function highlight(id) {
    [...document.querySelectorAll('.gcard')].forEach((n) => n.classList.remove('gcard--pick'));
    const node = document.querySelector(`.gcard[data-id="${id}"]`);
    if (node) {
      node.classList.add('gcard--pick');
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function gameCard(g) {
  const n = state.constraints.players;
  const bestFit = isBestAt(g, n);
  const card = el('div', 'gcard' + (bestFit ? ' gcard--fit' : ''));
  card.dataset.id = g.id;
  card.appendChild(thumb(g, 'lg'));
  const body = el('div', 'gcard__body');
  body.appendChild(txt('div', 'gcard__name', g.name));
  const meta = el('div', 'gcard__meta');
  const pill = (t, cls) => el('span', 'pill' + (cls ? ' ' + cls : ''), t);
  meta.appendChild(pill(`${g.minPlayers}–${g.maxPlayers >= 99 ? '∞' : g.maxPlayers} 👤`));
  const t = g.playTime || g.maxTime || g.minTime;
  if (t) meta.appendChild(pill(`${t}m ⏱`));
  if (g.weight) meta.appendChild(pill(`${g.weight.toFixed(1)} 🧠`));
  if (g.cooperative) meta.appendChild(pill('co-op 🤝'));
  if (g.pollVotes && Array.isArray(g.bestPlayers) && g.bestPlayers.length)
    // Accent the badge when your chosen count is one of the game's best counts.
    meta.appendChild(pill(`best ${formatCounts(g.bestPlayers)} 👍`, bestFit ? 'pill--fit' : ''));
  body.appendChild(meta);
  const owners = (g.owners || []).map((id) => (state.data.collections.find((c) => c.id === id) || {}).label || id);
  if (owners.length) body.appendChild(txt('div', 'gcard__owners', `On: ${owners.join(', ')}`));
  card.appendChild(body);
  return card;
}

// A tiny deterministic-ish PRNG seeded off the current filtered set, so
// "pick for me" varies but we avoid Math.random (keeps things testable).
let rngSeed = 1;
function deterministicRandom() {
  rngSeed = (rngSeed * 1103515245 + 12345 + finalGames().length * 7 + Date.now()) % 2147483648;
  return rngSeed / 2147483648;
}

// --- boot -------------------------------------------------------------------
async function boot() {
  render(); // loading
  try {
    state.data = await loadData();
    if (!state.data.games.length) return go('setup');
    // preselect all collections for convenience
    state.data.collections.forEach((c) => state.selected.add(c.id));
    if (state.data.sample) go('setup');
    else go('collections');
  } catch (e) {
    state._error = e.message;
    go('error');
  }
}
boot();
