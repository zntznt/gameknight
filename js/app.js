// app.js. Gameknight.
//
// One scrolling board of 11 numbered sections (00 shelves, 01–04 wants,
// 05–10 limits), then a verdict view with tonight's pick. Nothing selected in a
// section means that section simply doesn't filter. There is no skip control.
//
// Rendering is a full rebuild of each root on every state change. At collection
// scale (tens to low hundreds of games) that stays well inside a frame and
// keeps the data flow obvious; the strip's scroll offset is carried across.

import { loadData, poolFor, applyFilters, questionPredicate } from './data.js';
import { QUESTIONS, WEIGHT_BUCKETS } from './questions.js';

/* ------------------------------------------------------------------ dom -- */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // textContent throughout: BGG strings are untrusted
  return n;
};
const frag = () => document.createDocumentFragment();

/* ---------------------------------------------------------------- state -- */
const state = {
  data: null,
  view: 'board', // 'board' | 'verdict'
  selected: [], // shelf ids
  answers: {}, // questionId -> [optionId]
  constraints: { players: null, playerFit: 'rec', wKey: 'any', maxTime: null, minAge: null },
  sortBy: 'rating', // 'rating' | 'rank' | 'plays'
  pickId: null, // manual "Deal another" choice
  sheetGame: null,
  failed: {}, // game ids whose thumbnail 404'd
};

const SECTIONS = { players: '05', fit: '06', weight: '07', time: '08', age: '09', sort: '10' };

/* -------------------------------------------------------------- derived -- */
const bucketFor = (key) => WEIGHT_BUCKETS.find((b) => b.key === key) || WEIGHT_BUCKETS[0];

function basePool() {
  return poolFor(state.data, state.selected);
}

// `skip` excludes one limit so its chips can each show their own count.
function constraintPreds(c = state.constraints, skip = null) {
  const preds = [];
  const bk = bucketFor(c.wKey);
  if (c.players && skip !== 'players') preds.push((g) => fitsPlayers(g, c.players, c.playerFit));
  // Missing metadata always passes: unrated weight, unknown time, no minAge.
  //
  // Weight is a CEILING, not a band. The question asks how much brain you are
  // willing to spend, so anything heavier is out while anything lighter is
  // still perfectly playable. Preferring the weight you actually asked for is
  // handled by weightFit in the ranking, not by throwing lighter games away.
  if (skip !== 'weight' && bk.hi < 99) {
    preds.push((g) => !g.weight || g.weight < bk.hi);
  }
  if (c.maxTime && skip !== 'time') {
    preds.push((g) => {
      const t = g.playTime || g.maxTime || g.minTime || 0;
      return !t || t <= c.maxTime;
    });
  }
  if (c.minAge && skip !== 'age') preds.push((g) => !g.minAge || g.minAge <= c.minAge);
  return preds;
}

// Only the limits remove games. Wants never eliminate; see fitScore.
function remaining() {
  return applyFilters(basePool(), constraintPreds());
}

/* ------------------------------------------------------------ want fit -- */
// How many of the answered wants this game satisfies. Each answered question is
// worth one point regardless of how many options are ticked inside it, so a
// 10-option theme question cannot outweigh the single-choice mood question.
function fitScore(g) {
  let score = 0;
  for (const q of QUESTIONS) {
    const pred = questionPredicate(q, state.answers[q.id]);
    if (pred && pred(g)) score += 1;
  }
  return score;
}
// How many wants are in play at all, so fit can be shown as "2 of 3".
function answeredWants() {
  return QUESTIONS.filter((q) => (state.answers[q.id] || []).length > 0).length;
}

/* ---------------------------------------------------------- weight fit -- */
// Buckets excluding "Any", in ascending order, so a game's band is its index.
const RATED_BUCKETS = WEIGHT_BUCKETS.filter((b) => b.key !== 'any');
const bandOf = (g) => RATED_BUCKETS.findIndex((b) => g.weight >= b.lo && g.weight < b.hi);

// Higher is better, 0 being "exactly the weight you asked for". Heavier games
// are already gone by the time this runs (the ceiling filter), so this only
// ranks the chosen band above progressively lighter ones, one notch per bucket.
// An unrated weight takes a single notch: it survives the filter, but we cannot
// claim it is what you asked for, so it should not outrank a confirmed match.
function weightFit(g) {
  const key = state.constraints.wKey;
  if (key === 'any') return 0; // no preference expressed
  const target = RATED_BUCKETS.findIndex((b) => b.key === key);
  if (target < 0) return 0;
  if (!g.weight) return -1;
  const band = bandOf(g);
  if (band < 0) return -1;
  return -Math.abs(target - band);
}

function anyFilters() {
  const c = state.constraints;
  return (
    QUESTIONS.some((q) => (state.answers[q.id] || []).length > 0) ||
    !!c.players || !!c.maxTime || !!c.minAge || c.wKey !== 'any'
  );
}

/* ---------------------------------------------------------- player fit -- */
// 'supported' = the box min–max. 'rec'/'best' = BGG's suggested-players poll.
// A game with no poll votes falls back to the box range in all three modes.
// The "8" chip means "8 or more".
function fitsPlayers(g, n, mode) {
  const atLeast = n >= 8;
  const inBox = atLeast ? g.maxPlayers >= 8 : g.minPlayers <= n && g.maxPlayers >= n;
  if (mode === 'supported') return inBox;
  const arr = mode === 'best' ? g.bestPlayers : g.recPlayers;
  if (!g.pollVotes || !Array.isArray(arr) || !arr.length) return inBox;
  return atLeast ? arr.some((c) => c >= 8) : arr.includes(n);
}
function isBestAt(g, n) {
  if (!n || !g.pollVotes || !Array.isArray(g.bestPlayers)) return false;
  return n >= 8 ? g.bestPlayers.some((c) => c >= 8) : g.bestPlayers.includes(n);
}
function isRecAt(g, n) {
  if (!n || !g.pollVotes || !Array.isArray(g.recPlayers)) return false;
  return n >= 8 ? g.recPlayers.some((c) => c >= 8) : g.recPlayers.includes(n);
}
// Only used to tint the shortlist tag. Ordering comes from section 10.
function fitTier(g) {
  const c = state.constraints;
  if (!c.players || c.playerFit === 'supported') return 0;
  const best = isBestAt(g, c.players);
  const rec = isRecAt(g, c.players);
  if (c.playerFit === 'best') return best ? 3 : rec ? 2 : 1;
  return rec ? 3 : best ? 2 : 1;
}

/* -------------------------------------------------------------- sorting -- */
const playsThisMonth = (g) => g.playsThisMonth || 0;

// Best fit first, then the metric chosen in section 10 settles the order among
// games that fit equally well.
function sortGames(games) {
  const by = state.sortBy;
  return games.slice().sort((a, b) => {
    const fit = fitScore(b) - fitScore(a);
    if (fit) return fit;
    // Then closeness to the weight you asked for, so a medium night surfaces
    // medium games ahead of the fillers it also allows.
    const w = weightFit(b) - weightFit(a);
    if (w) return w;
    if (by === 'plays') {
      const d = playsThisMonth(b) - playsThisMonth(a);
      if (d) return d;
    }
    if (by === 'rank') {
      const ra = a.rank > 0 ? a.rank : Infinity;
      const rb = b.rank > 0 ? b.rank : Infinity;
      if (ra !== rb) return ra - rb; // unranked sinks to the bottom
    }
    return (b.rating || 0) - (a.rating || 0); // ties always break on rating
  });
}

/* ----------------------------------------------------------- formatting -- */
// Compress [1,2,3,5] → "1–3, 5".
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

function timeStr(g) {
  const lo = g.minTime;
  const hi = g.playTime || g.maxTime || g.minTime;
  if (!hi) return 'time unknown';
  return lo && hi && lo !== hi ? `${lo}–${hi} min` : `${hi} min`;
}

function metaLine(g) {
  const hi = g.maxPlayers >= 99 ? '∞' : g.maxPlayers;
  const players =
    g.minPlayers === g.maxPlayers
      ? g.maxPlayers === 1
        ? 'solo only'
        : `${g.maxPlayers} players exactly`
      : `${g.minPlayers}–${hi} players`;
  const weight = g.weight ? `weight ${g.weight.toFixed(1)}` : 'weight unrated';
  return [players, timeStr(g), weight].join('  ·  ');
}

// The headline number always matches section 10's choice.
function sortTag(g, short) {
  const by = state.sortBy;
  if (by === 'rank') {
    if (!(g.rank > 0)) return short ? 'n/a' : 'unranked';
    return short ? `#${g.rank}` : `BGG #${g.rank}`;
  }
  if (by === 'plays') {
    const n = playsThisMonth(g);
    if (short) return `${n}×`;
    return n ? `${n} play${n === 1 ? '' : 's'} this month` : 'unplayed this month';
  }
  if (!g.rating) return short ? 'n/a' : 'unrated';
  return short ? `★ ${g.rating.toFixed(1)}` : `★ ${g.rating.toFixed(1)} rating`;
}

function tagsFor(g) {
  const n = state.constraints.players;
  const out = [{ text: sortTag(g), cls: 'gk-tag--sort' }];
  // Show how the pick answered your wants, so the ordering is explainable
  // rather than mysterious. Only meaningful once a want has been expressed.
  const asked = answeredWants();
  if (asked > 0) {
    const got = fitScore(g);
    out.push({
      text: `matches ${got} of ${asked} want${asked === 1 ? '' : 's'}`,
      cls: got === asked ? 'gk-tag--fit' : '',
    });
  }
  if (g.pollVotes && Array.isArray(g.bestPlayers) && g.bestPlayers.length) {
    out.push({
      text: `best at ${formatCounts(g.bestPlayers)}`,
      cls: isBestAt(g, n) ? 'gk-tag--fit' : '',
    });
  }
  if (g.cooperative) out.push({ text: 'co-op', cls: '' });
  (g.categories || []).slice(0, 2).forEach((c) => out.push({ text: c, cls: '' }));
  (g.mechanics || []).slice(0, 2).forEach((m) => out.push({ text: m, cls: '' }));
  return out;
}

function ownersLine(g) {
  const cols = (state.data && state.data.collections) || [];
  const names = (g.owners || []).map((id) => (cols.find((c) => c.id === id) || {}).label || id);
  return names.length ? `Owned by ${names.join(' & ')}` : '';
}

/* ---------------------------------------------------------------- tiles -- */
function initialsFor(g) {
  return (g.name || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 2).toUpperCase() || '?';
}

// A dead thumbnail is remembered per game id so the monogram sticks. Failures
// arrive in bursts (a whole strip at once), so coalesce them into one re-render
// instead of one per image.
let failTimer = null;
function markFailed(id) {
  if (state.failed[id]) return;
  state.failed[id] = true;
  clearTimeout(failTimer);
  failTimer = setTimeout(render, 60);
}

// size: 34 | 44 | 72 | 96
function tile(g, size, tag = 'span') {
  const wrap = el(tag, `gk-tile gk-tile--${size}`);
  const broken = !g.thumbnail || state.failed[g.id];
  if (broken) {
    wrap.appendChild(el('span', 'gk-tile__ini', initialsFor(g)));
    return wrap;
  }
  const img = el('img');
  img.src = g.thumbnail;
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => markFailed(g.id);
  wrap.appendChild(img);
  return wrap;
}

function tagRow(g) {
  const row = el('div', 'gk-tags');
  tagsFor(g).forEach((t) => row.appendChild(el('span', `gk-tag ${t.cls}`.trim(), t.text)));
  return row;
}

/* --------------------------------------------------- guided scroll ------- */
// Advances on a section's FIRST pick, disarms when the reader takes over,
// re-arms (and pulls the nearest section square) after an idle pause.
const guide = { armed: true, progScroll: false, scrollRef: 0, lastActivity: Date.now(), timer: null };

const headerH = () => {
  const h = $('.gk-header');
  return h ? h.offsetHeight : 82;
};
const sectionEls = () => [...document.querySelectorAll('main section[data-gk-section]')];

function scrollToSection(i, correct = true) {
  const node = sectionEls()[i];
  if (!node) return;
  const anchor = headerH() + 10;
  const top = Math.max(0, node.getBoundingClientRect().top + window.scrollY - anchor);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  guide.progScroll = true;
  window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  clearTimeout(guide.timer);
  guide.timer = setTimeout(() => {
    // The target can shift while we travel (revealing a control grows the page),
    // so land, re-measure, and correct once.
    const now = sectionEls()[i];
    if (correct && now && Math.abs(now.getBoundingClientRect().top - anchor) > 24) {
      scrollToSection(i, false);
      return;
    }
    guide.progScroll = false;
    guide.scrollRef = window.scrollY;
    guide.lastActivity = Date.now();
  }, 900);
}

function advanceFrom(sectionId) {
  if (!guide.armed) return;
  setTimeout(() => {
    if (!guide.armed) return;
    const i = sectionEls().findIndex((n) => n.dataset.gkSection === String(sectionId));
    if (i >= 0) scrollToSection(i + 1);
  }, 220);
}

function nearestSection() {
  const anchor = headerH() + 12;
  let index = 0;
  let bestD = Infinity;
  let delta = 0;
  sectionEls().forEach((node, i) => {
    const top = node.getBoundingClientRect().top;
    const d = Math.abs(top - anchor);
    if (d < bestD) {
      bestD = d;
      index = i;
      delta = top - anchor;
    }
  });
  return { index, delta };
}

function checkIdle() {
  if (state.view !== 'board' || state.sheetGame || guide.progScroll) return;
  if (Date.now() - guide.lastActivity < 2600) return;
  const { index, delta } = nearestSection();
  guide.armed = true; // re-arm unconditionally
  guide.lastActivity = Date.now();
  if (Math.abs(delta) > 26) scrollToSection(index);
  else guide.scrollRef = window.scrollY;
}

/* --------------------------------------------------------------- render -- */
function setState(patch) {
  Object.assign(state, patch);
  render();
}
// Any change to a filter, a shelf, or the sort clears the manual pick.
function setConstraint(patch) {
  Object.assign(state.constraints, patch);
  state.pickId = null;
  render();
}

function sectionHead(num, title, answered) {
  const head = el('div', 'gk-sechead');
  head.appendChild(el('span', `gk-badge${answered ? ' gk-badge--on' : ''}`, num));
  head.appendChild(el('h2', 'gk-sectitle', title));
  return head;
}

function makeSection(num, title, answered, body) {
  const sec = el('section', 'gk-section');
  sec.dataset.gkSection = num;
  sec.appendChild(sectionHead(num, title, answered));
  sec.appendChild(body);
  return sec;
}

/* --- header live row ------------------------------------------------------ */
function renderLive() {
  const root = $('#gkLive');
  const prevScroll = root.querySelector('.gk-strip')?.scrollLeft || 0;
  if (!state.data) {
    root.replaceChildren();
    return;
  }
  const out = frag();

  const games = sortGames(remaining());
  const total = basePool().length;

  const live = el('div', 'gk-live');
  live.appendChild(el('span', `gk-live__n${games.length === 0 ? ' gk-live__n--zero' : ''}`, String(games.length)));
  live.appendChild(el('span', 'gk-live__total', `/ ${total}`));
  out.appendChild(live);

  if (anyFilters()) {
    const clear = el('button', 'gk-clear', 'clear');
    clear.type = 'button';
    clear.onclick = resetAll;
    out.appendChild(clear);
  }

  const strip = el('div', 'gk-strip');
  if (games.length === 0) {
    strip.appendChild(el('div', 'gk-strip__empty', 'Nothing fits. Something has to give.'));
  } else {
    games.forEach((g) => {
      const btn = tile(g, 34, 'button');
      btn.type = 'button';
      btn.title = g.name;
      btn.setAttribute('aria-label', `${g.name}, details`);
      btn.onclick = () => setState({ sheetGame: g });
      strip.appendChild(btn);
    });
  }
  out.appendChild(strip);
  root.replaceChildren(out);
  strip.scrollLeft = prevScroll;
}

/* --- 00 shelves ----------------------------------------------------------- */
function renderShelves() {
  const grid = el('div', 'gk-shelves');
  state.data.collections.forEach((col) => {
    const on = state.selected.includes(col.id);
    const count = state.data.games.filter((g) => (g.owners || []).includes(col.id)).length;

    const wrap = el('div', 'gk-shelf');
    const btn = el('button', `gk-shelf__btn${on ? ' gk-shelf__btn--on' : ''}`);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // The owner's BGG avatar when the bake found one, else a typographic
    // monogram. A dead avatar URL falls back to the monogram too.
    const monogram = (col.label || col.bggUser || '?').trim().charAt(0).toUpperCase();
    const avatar = el('span', 'gk-shelf__avatar');
    if (col.avatar && !state.failed[`av:${col.id}`]) {
      const img = el('img');
      img.src = col.avatar;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => markFailed(`av:${col.id}`);
      avatar.appendChild(img);
    } else {
      avatar.textContent = monogram;
    }
    btn.appendChild(avatar);
    const text = el('span', 'gk-shelf__text');
    text.appendChild(el('span', 'gk-shelf__label', col.label));
    text.appendChild(
      el('span', 'gk-shelf__sub', `${col.bggUser ? '@' + col.bggUser : ''} · ${count} games`)
    );
    btn.appendChild(text);
    btn.appendChild(el('span', 'gk-shelf__dot'));
    btn.onclick = () => {
      state.selected = on
        ? state.selected.filter((x) => x !== col.id)
        : [...state.selected, col.id];
      state.pickId = null;
      render();
    };
    wrap.appendChild(btn);

    const link = el('a', 'gk-shelf__link', '↗');
    link.href = col.bggUser ? `https://boardgamegeek.com/user/${col.bggUser}` : 'https://boardgamegeek.com';
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = col.bggUser ? `${col.bggUser} on BoardGameGeek` : 'BoardGameGeek';
    wrap.appendChild(link);

    grid.appendChild(wrap);
  });
  return makeSection('00', 'Whose shelves are we raiding?', true, grid);
}

/* --- 01–04 wants ---------------------------------------------------------- */
function renderWants() {
  const out = frag();
  const base = basePool();

  QUESTIONS.forEach((q, qi) => {
    const num = String(qi + 1).padStart(2, '0');
    const sel = new Set(state.answers[q.id] || []);
    // Counts are honest against every OTHER filter, since there is no step order.
    // Wants no longer eliminate, so a count here answers "how many playable
    // games have this quality", measured against the limits only. It is a
    // description of the shelf rather than a threat to shrink it.
    const context = applyFilters(base, constraintPreds());

    const grid = el('div', 'gk-options');
    q.options.forEach((o) => {
      const on = sel.has(o.id);
      const count = context.filter(o.match).length;

      const btn = el('button', `gk-option${on ? ' gk-option--on' : ''}${count === 0 && !on ? ' gk-option--empty' : ''}`);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.appendChild(el('span', 'gk-option__label', o.label));
      btn.appendChild(
        el('span', `gk-option__count${count === 0 ? ' gk-option__count--zero' : ''}`, String(count))
      );
      btn.onclick = () => {
        const firstPick = (state.answers[q.id] || []).length === 0;
        const cur = new Set(state.answers[q.id] || []);
        let next;
        if (q.type === 'single') next = cur.has(o.id) ? [] : [o.id];
        else {
          if (cur.has(o.id)) cur.delete(o.id);
          else cur.add(o.id);
          next = [...cur];
        }
        state.answers = { ...state.answers, [q.id]: next };
        state.pickId = null;
        render();
        if (firstPick) advanceFrom(num); // later picks must not move the page
      };
      grid.appendChild(btn);
    });

    out.appendChild(makeSection(num, q.title, sel.size > 0, grid));
  });
  return out;
}

/* --- 05–10 limits --------------------------------------------------------- */
// `zeroSub` turns the sub-line vermilion, matching the want options: a choice
// that would leave nothing dims AND flags its count. Section 10's sub-line is a
// text hint rather than a count, so it never sets this.
function chip({ label, sub, on, empty, zeroSub, onClick }) {
  const btn = el('button', `gk-chip${on ? ' gk-chip--on' : ''}${empty ? ' gk-chip--empty' : ''}`);
  btn.type = 'button';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.appendChild(el('span', null, label));
  btn.appendChild(el('span', `gk-chip__sub${zeroSub ? ' gk-chip__sub--zero' : ''}`, sub));
  btn.onclick = onClick;
  return btn;
}

function renderLimits() {
  const out = frag();
  const c = state.constraints;
  const base = basePool();
  // Limits still filter, so a chip count is a genuine "this many would remain".
  // Wants are excluded from the context because they no longer remove anything.
  const ctxFor = (skip) => applyFilters(base, constraintPreds(c, skip));

  // A chip row where "Any" clears the value; each chip counts its own value
  // with every other filter applied.
  const valueRow = (skip, values, current, key, fmt, sectionId, countFn) => {
    const ctx = ctxFor(skip);
    const grid = el('div', 'gk-chips');
    const mk = (val, label) => {
      const on = current === val;
      const count = val === null ? ctx.length : ctx.filter((g) => countFn(g, val)).length;
      return chip({
        label,
        sub: String(count),
        on,
        empty: count === 0 && !on,
        zeroSub: count === 0 && !on,
        onClick: () => {
          const was = current;
          setConstraint({ [key]: val });
          if (was == null && val != null) advanceFrom(sectionId);
        },
      });
    };
    grid.appendChild(mk(null, 'Any'));
    values.forEach((v) => grid.appendChild(mk(v, String(fmt(v)))));
    return grid;
  };

  // 05 · players
  out.appendChild(
    makeSection(
      SECTIONS.players,
      'How many at the table?',
      !!c.players,
      valueRow(
        'players',
        [1, 2, 3, 4, 5, 6, 7, 8],
        c.players,
        'players',
        (v) => (v === 8 ? '8+' : v),
        SECTIONS.players,
        (g, v) => fitsPlayers(g, v, c.playerFit)
      )
    )
  );

  // 06 · how well it needs to play at that count (always present)
  {
    const ctx = ctxFor('players');
    const grid = el('div', 'gk-chips');
    [['best', 'Best'], ['rec', 'Recommended'], ['supported', 'Box supports']].forEach(([val, label]) => {
      const on = c.playerFit === val;
      const count = c.players ? ctx.filter((g) => fitsPlayers(g, c.players, val)).length : ctx.length;
      grid.appendChild(
        chip({
          label,
          sub: String(count),
          on,
          empty: count === 0 && !on,
          zeroSub: count === 0 && !on,
          onClick: () => {
            const was = c.playerFit;
            setConstraint({ playerFit: val });
            if (was !== val) advanceFrom(SECTIONS.fit);
          },
        })
      );
    });
    const title = c.players
      ? `How well does it need to play at ${c.players === 8 ? '8+' : c.players}?`
      : 'How well does it need to play at our count?';
    out.appendChild(makeSection(SECTIONS.fit, title, !!c.players, grid));
  }

  // 07 · weight
  {
    const ctx = ctxFor('weight');
    const grid = el('div', 'gk-chips');
    WEIGHT_BUCKETS.forEach((bk) => {
      const on = c.wKey === bk.key;
      // Cumulative, because the bucket is a ceiling: "Medium" counts everything
      // medium and lighter, which is what picking it would actually leave you.
      const count = bk.hi >= 99 ? ctx.length : ctx.filter((g) => !g.weight || g.weight < bk.hi).length;
      grid.appendChild(
        chip({
          label: bk.label,
          sub: String(count),
          on,
          empty: count === 0 && !on,
          zeroSub: count === 0 && !on,
          onClick: () => {
            const was = c.wKey;
            setConstraint({ wKey: bk.key });
            if (was === 'any' && bk.key !== 'any') advanceFrom(SECTIONS.weight);
          },
        })
      );
    });
    out.appendChild(
      makeSection(SECTIONS.weight, 'How much brainpower are we willing to spend?', c.wKey !== 'any', grid)
    );
  }

  // 08 · time
  out.appendChild(
    makeSection(
      SECTIONS.time,
      'How much time have we got to play?',
      !!c.maxTime,
      valueRow('time', [15, 30, 45, 60, 90, 120, 180], c.maxTime, 'maxTime', (v) => `≤ ${v}m`, SECTIONS.time, (g, v) => {
        const t = g.playTime || g.maxTime || g.minTime || 0;
        return !t || t <= v;
      })
    )
  );

  // 09 · age
  out.appendChild(
    makeSection(
      SECTIONS.age,
      'Anyone young among us?',
      !!c.minAge,
      valueRow('age', [6, 8, 10, 12, 14], c.minAge, 'minAge', (v) => `${v}+`, SECTIONS.age, (g, v) => !g.minAge || g.minAge <= v)
    )
  );

  // 10 · sort. Always answered, so the badge is always filled.
  {
    const grid = el('div', 'gk-chips');
    [
      ['rating', 'BGG rating', 'high first'],
      ['rank', 'BGG rank', 'low first'],
      ['plays', 'Plays this month', 'most first'],
    ].forEach(([val, label, hint]) => {
      grid.appendChild(
        chip({
          label,
          sub: hint,
          on: state.sortBy === val,
          empty: false,
          onClick: () => setState({ sortBy: val, pickId: null }),
        })
      );
    });
    out.appendChild(makeSection(SECTIONS.sort, 'What score settles the decision?', true, grid));
  }

  return out;
}

/* --- board ---------------------------------------------------------------- */
function buildBoard() {
  const main = el('main', 'gk-main');
  main.appendChild(renderShelves());
  main.appendChild(renderWants());
  main.appendChild(renderLimits());

  const bar = el('div', 'gk-bar');
  const inner = el('div', 'gk-bar__inner');
  const deal = el('button', 'gk-deal');
  deal.type = 'button';
  deal.appendChild(el('span', null, 'Make the move'));
  deal.appendChild(el('span', 'gk-deal__knight', '♞'));
  deal.disabled = remaining().length === 0;
  deal.onclick = () => {
    setState({ view: 'verdict' });
    window.scrollTo({ top: 0 });
  };
  inner.appendChild(deal);
  bar.appendChild(inner);
  return { main, bar };
}

/* --- verdict -------------------------------------------------------------- */
function buildVerdict() {
  const main = el('main', 'gk-main gk-main--verdict');
  const ranked = sortGames(remaining());
  const hero = ranked.find((g) => g.id === state.pickId) || ranked[0];

  const actions = el('div', 'gk-vactions');
  const back = el('button', 'gk-vbtn');
  back.type = 'button';
  back.appendChild(el('span', 'gk-vbtn__glyph', '←'));
  back.appendChild(el('span', null, 'Back to the board'));
  back.onclick = () => {
    setState({ view: 'board' });
    window.scrollTo({ top: 0 });
  };
  actions.appendChild(back);
  if (ranked.length > 1) {
    const again = el('button', 'gk-vbtn');
    again.type = 'button';
    again.appendChild(el('span', null, 'Deal another'));
    again.appendChild(el('span', 'gk-vbtn__glyph', '↻'));
    again.onclick = () => {
      const pool = ranked.filter((g) => !hero || g.id !== hero.id);
      if (pool.length) setState({ pickId: pool[Math.floor(Math.random() * pool.length)].id });
    };
    actions.appendChild(again);
  }
  main.appendChild(actions);

  if (!hero) {
    const card = el('section', 'gk-empty');
    card.appendChild(el('h1', 'gk-empty__title', 'Nothing survived.'));
    card.appendChild(
      el('p', 'gk-empty__body', 'Every game got filtered out. The shelf isn’t infinite, so drop a want or loosen a limit.')
    );
    const row = el('div', 'gk-empty__actions');
    const toBoard = el('button', 'gk-btn-ink', 'Back to the board');
    toBoard.type = 'button';
    toBoard.onclick = () => {
      setState({ view: 'board' });
      window.scrollTo({ top: 0 });
    };
    const clear = el('button', 'gk-btn-outline', 'Clear everything');
    clear.type = 'button';
    clear.onclick = resetAll;
    row.appendChild(toBoard);
    row.appendChild(clear);
    card.appendChild(row);
    main.appendChild(card);
    return main;
  }

  // hero card
  const card = el('section', 'gk-hero');
  const label = el('div', 'gk-hero__label');
  label.appendChild(el('span', 'gk-hero__dot'));
  label.appendChild(el('span', 'gk-hero__labeltext', 'Tonight’s move'));
  card.appendChild(label);

  const row = el('div', 'gk-hero__row');
  row.appendChild(tile(hero, 96));
  const text = el('div', 'gk-hero__text');
  text.appendChild(el('h1', 'gk-hero__title', hero.name));
  text.appendChild(el('div', 'gk-hero__meta', metaLine(hero)));
  text.appendChild(tagRow(hero));
  const owners = ownersLine(hero);
  if (owners) text.appendChild(el('div', 'gk-hero__owners', owners));
  row.appendChild(text);
  card.appendChild(row);

  const foot = el('div', 'gk-hero__foot');
  const cta = el('a', 'gk-hero__cta', 'Rules & photos on BGG ↗');
  cta.href = `https://boardgamegeek.com/boardgame/${hero.id}`;
  cta.target = '_blank';
  cta.rel = 'noopener';
  foot.appendChild(cta);
  card.appendChild(foot);
  main.appendChild(card);

  // shortlist
  const rest = ranked.filter((g) => g.id !== hero.id);
  if (rest.length) {
    const sec = el('section', 'gk-shortlist');
    const head = el('div', 'gk-shortlist__head');
    head.appendChild(el('span', 'gk-shortlist__title', 'Also on the table'));
    const byLabel = state.sortBy === 'plays' ? 'plays this month' : state.sortBy;
    // Say fit first when wants are in play, since that is what actually drives
    // the order; the section 10 metric only settles ties.
    const order = answeredWants() > 0 ? `fit, then ${byLabel}` : byLabel;
    head.appendChild(el('span', 'gk-shortlist__count', `${rest.length} · by ${order}`));
    sec.appendChild(head);

    const rows = el('div', 'gk-rows');
    rest.forEach((g) => {
      const btn = el('button', 'gk-row');
      btn.type = 'button';
      btn.appendChild(tile(g, 44));
      const t = el('span', 'gk-row__text');
      t.appendChild(el('span', 'gk-row__name', g.name));
      t.appendChild(el('span', 'gk-row__meta', metaLine(g)));
      btn.appendChild(t);
      btn.appendChild(
        el('span', `gk-row__tag${fitTier(g) === 3 ? ' gk-row__tag--fit' : ''}`, sortTag(g, true))
      );
      btn.onclick = () => setState({ sheetGame: g });
      rows.appendChild(btn);
    });
    sec.appendChild(rows);
    main.appendChild(sec);
  }

  return main;
}

/* --- quick-look sheet ----------------------------------------------------- */
function renderSheet() {
  const root = $('#gkSheetRoot');
  root.textContent = '';
  const g = state.sheetGame;
  if (!g) return;

  const backdrop = el('div', 'gk-sheet-backdrop');
  backdrop.onclick = () => setState({ sheetGame: null });

  const sheet = el('div', 'gk-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', g.name);
  sheet.onclick = (e) => e.stopPropagation();

  const head = el('div', 'gk-sheet__head');
  head.appendChild(tile(g, 72));
  const titles = el('span', 'gk-sheet__titles');
  titles.appendChild(el('span', 'gk-sheet__name', g.name));
  titles.appendChild(el('span', 'gk-sheet__meta', metaLine(g)));
  head.appendChild(titles);
  const close = el('button', 'gk-sheet__close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.onclick = () => setState({ sheetGame: null });
  head.appendChild(close);
  sheet.appendChild(head);

  const body = el('div', 'gk-sheet__body');
  body.appendChild(tagRow(g));
  const owners = ownersLine(g);
  if (owners) body.appendChild(el('div', 'gk-sheet__owners', owners));
  const foot = el('div', 'gk-sheet__foot');
  const cta = el('a', 'gk-sheet__cta', 'On BGG ↗');
  cta.href = `https://boardgamegeek.com/boardgame/${g.id}`;
  cta.target = '_blank';
  cta.rel = 'noopener';
  foot.appendChild(cta);
  body.appendChild(foot);
  sheet.appendChild(body);

  backdrop.appendChild(sheet);
  root.appendChild(backdrop);
  close.focus();
}

function resetAll() {
  state.answers = {};
  state.pickId = null;
  state.constraints = { players: null, playerFit: 'rec', wKey: 'any', maxTime: null, minAge: null };
  render();
}

function render() {
  const root = $('#gkRoot');
  const barRoot = $('#gkBarRoot');

  if (!state.data) {
    root.replaceChildren(el('div', 'gk-loading', 'Loading the shelf…'));
    barRoot.replaceChildren();
    renderSheet();
    return;
  }

  // Build first, swap second. Emptying the roots up front would collapse the
  // page to zero height, and the browser resets scrollY when that happens,
  // which is what used to throw you back to the top on every click. A single
  // replaceChildren() never leaves the document short.
  const keepY = window.scrollY;
  const built = state.view === 'board' ? buildBoard() : { main: buildVerdict(), bar: null };

  // The header only follows you on the board; on the verdict it scrolls away.
  $('.gk-header').classList.toggle('gk-header--flat', state.view === 'verdict');

  // Point the source badge at whichever repo baked this data. Falls back to the
  // href in index.html when the bake predates the site block, so a fork that
  // has not re-fetched yet still has a working link.
  const repoUrl = state.data.site && state.data.site.repoUrl;
  if (repoUrl) $('.gk-gh').href = repoUrl;

  renderLive();
  root.replaceChildren(built.main);
  if (built.bar) barRoot.replaceChildren(built.bar);
  else barRoot.replaceChildren();
  renderSheet();

  // Belt and braces: if the swap still moved us (a genuinely shorter page), put
  // it back, unless a guided scroll is mid-flight and owns the position.
  if (state.view === 'board' && !guide.progScroll && window.scrollY !== keepY) {
    window.scrollTo(0, keepY);
  }
}

/* ----------------------------------------------------------------- boot -- */
async function boot() {
  render();
  try {
    state.data = await loadData();
    state.selected = (state.data.collections || []).map((c) => c.id); // all shelves on
  } catch (e) {
    $('#gkRoot').replaceChildren(el('div', 'gk-loading', `Could not load the shelf. ${e.message}`));
    return;
  }
  render();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.sheetGame) setState({ sheetGame: null });
  });

  guide.scrollRef = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      guide.lastActivity = Date.now();
      if (guide.progScroll) return;
      if (Math.abs(window.scrollY - guide.scrollRef) > 120) guide.armed = false;
    },
    { passive: true }
  );
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, () => { guide.lastActivity = Date.now(); }, { passive: true })
  );
  setInterval(checkIdle, 400);
}

boot();
