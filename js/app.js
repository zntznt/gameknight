// app.js. Gameknight.
//
// One scrolling board of numbered sections (00 shelves, then the wants, then
// the limits), and a verdict view with tonight's pick. Nothing selected in a
// section means that section simply doesn't filter. There is no skip control.
//
// Rendering is a full rebuild of each root on every state change. At collection
// scale (tens to low hundreds of games) that stays well inside a frame and
// keeps the data flow obvious; the strip's scroll offset is carried across.

import { loadData, poolFor, applyFilters } from './data.js';
import { QUESTIONS, WEIGHT_BUCKETS } from './questions.js';
import * as rank from './ranking.js';

/* ------------------------------------------------------------------ dom -- */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // textContent throughout: BGG strings are untrusted
  return n;
};
const frag = () => document.createDocumentFragment();

// The mark as an inline SVG, so anywhere the app draws the knight draws the same
// one. Kept in step with icons/knight.svg and index.html by hand; there is one
// path and no build step to derive it.
const KNIGHT_VIEWBOX = '523.862 373.852 1085.178 1304.128';
const KNIGHT_PATH = document.querySelector('.gk-mark svg path')?.getAttribute('d') || '';
function knightGlyph(cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', KNIGHT_VIEWBOX);
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', KNIGHT_PATH);
  svg.appendChild(path);
  return svg;
}

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
  sheetOpener: null, // gk-key of the control that opened the sheet, to hand focus back
  failed: {}, // game ids whose thumbnail 404'd
};

// Section numbers: 00 is the shelves, then one per want, then the limits.
// Derived from QUESTIONS.length so adding or removing a want renumbers the
// limits automatically instead of silently colliding with a want's number.
const num2 = (n) => String(n).padStart(2, '0');
const LIMITS_START = QUESTIONS.length + 1;
const SECTIONS = ['players', 'fit', 'weight', 'time', 'age', 'sort'].reduce(
  (acc, key, i) => ({ ...acc, [key]: num2(LIMITS_START + i) }),
  {}
);

// How many of the top-ranked games "Deal another" chooses between.
const DEAL_WINDOW = 10;

// The ordering rules live in ranking.js as pure functions, so they can be
// tested without a browser. What follows is only the plumbing: each wrapper
// hands the current state to one of them, which keeps every call site below
// unchanged and keeps `state` from leaking into the rules themselves.
const { TIME_CAPS, timeOf, fitsPlayers, isBestAt, playsThisMonth } = rank;

const constraintPreds = (c = state.constraints, skip = null) => rank.constraintPreds(c, skip);
const fitScore = (g) => rank.fitScore(g, state.answers);
const answeredWants = () => rank.answeredWants(state.answers);
const fitTier = (g) => rank.fitTier(g, state.constraints);
const anyFilters = () => rank.anyFilters(state.answers, state.constraints);
const sortGames = (games) => rank.sortGames(games, state);

function basePool() {
  return poolFor(state.data, state.selected);
}

// Only the limits remove games. Wants never eliminate; see fitScore.
function remaining() {
  return applyFilters(basePool(), constraintPreds());
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

// The headline number always matches the sort section's choice.
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

// How many OTHER survivors match exactly as many wants as this one. Recomputed
// rather than cached because the pool changes with every limit, and at shelf
// scale the whole board is rebuilt on each render anyway.
function tiedAtFit(g, got, pool) {
  return pool.filter((x) => x.id !== g.id && fitScore(x) === got).length;
}

function tagsFor(g, isHero, pool) {
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
    // "matches 1 of 1" reads like the game was singled out. With one want
    // answered a median of 40 other games match just as well, and the sort
    // metric alone picked between them. Saying so is the honest version, and it
    // is the difference between a verdict that was earned and one that was a
    // coin flip. Only shown on the hero card, where the claim is being made.
    const alsoTied = isHero ? tiedAtFit(g, got, pool) : 0;
    if (alsoTied > 0) out.push({ text: `${alsoTied} tied on fit`, cls: 'gk-tag--muted' });
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
  // Off the main thread: up to 137 of these are created at once when the strip
  // rebuilds, and decoding them synchronously blocks the tap that caused it.
  img.decoding = 'async';
  img.onerror = () => markFailed(g.id);
  wrap.appendChild(img);
  return wrap;
}

function tagRow(g, isHero, pool) {
  const row = el('div', 'gk-tags');
  tagsFor(g, isHero, pool).forEach((t) =>
    row.appendChild(el('span', `gk-tag ${t.cls}`.trim(), t.text))
  );
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
// What a screen reader hears when the shelf changes size.
//
// The visible count lives in a row that is rebuilt in full on every render and
// holds one button per surviving game. Marking that row aria-live, which is what
// it used to be, meant every tap re-announced the entire shelf by name: opening
// a game's details read out all 137 of them, and so did changing the sort, which
// does not change the count at all. This writes one sentence into a node the
// render never touches, and stays quiet unless the number actually moved.
function announceCount(fit, total) {
  const node = $('#gkLiveMsg');
  if (!node) return;
  const msg = fit === 0 ? 'Nothing fits. Something has to give.' : `${fit} of ${total} games fit`;
  if (node.textContent !== msg) node.textContent = msg;
}

// `games` is the shared per-render ordering. render() is the only caller and it
// only calls this once the data has loaded, so there is no empty case to guard.
function renderLive(games) {
  const root = $('#gkLive');
  const prevScroll = root.querySelector('.gk-strip')?.scrollLeft || 0;
  const out = frag();

  const total = basePool().length;
  announceCount(games.length, total);

  const live = el('div', 'gk-live');
  live.appendChild(el('span', `gk-live__n${games.length === 0 ? ' gk-live__n--zero' : ''}`, String(games.length)));
  live.appendChild(el('span', 'gk-live__total', `/ ${total}`));
  out.appendChild(live);

  if (anyFilters()) {
    const clear = el('button', 'gk-clear', 'clear');
    clear.type = 'button';
    clear.dataset.gkKey = 'clear';
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
      btn.dataset.gkKey = `strip:${g.id}`;
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
    btn.dataset.gkKey = `shelf:${col.id}`;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // The owner's BGG avatar when the bake found one, else a typographic
    // monogram. A dead avatar URL falls back to the monogram too.
    const monogram = (col.label || col.bggUser || '?').trim().charAt(0).toUpperCase();
    const avatar = el('span', 'gk-shelf__avatar');
    // Decoration either way, and when it falls back to the letter it was
    // leaking a stray "Z" into the button's accessible name: the shelf read as
    // "Z Zeo @zntznt 69 games".
    avatar.setAttribute('aria-hidden', 'true');
    if (col.avatar && !state.failed[`av:${col.id}`]) {
      const img = el('img');
      img.src = col.avatar;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
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

/* --- the wants ------------------------------------------------------------ */
function renderWants() {
  const out = frag();
  const base = basePool();
  // Counts are honest against every OTHER filter, since there is no step order.
  // Wants no longer eliminate, so a count here answers "how many playable
  // games have this quality", measured against the limits only. It is a
  // description of the shelf rather than a threat to shrink it.
  //
  // Hoisted out of the loop below. Nothing inside it varies per question, so
  // this was re-running the identical filter pass over the whole shelf once for
  // every want section on the board.
  const context = applyFilters(base, constraintPreds());

  QUESTIONS.forEach((q, qi) => {
    const num = num2(qi + 1);
    const sel = new Set(state.answers[q.id] || []);

    const grid = el('div', 'gk-options');
    // Cap the columns at a divisor of the option count so the last row fills.
    // Six options used to lay out 5+1 on anything wider than 900px, leaving one
    // chip alone beside four empty columns; capped at 3 they sit 3+3. Nothing
    // below 3 is worth having, since forcing 14 options into 2 columns to make
    // them divide evenly would be a worse layout than the ragged last row.
    // Where no divisor qualifies the property stays unset and CSS keeps its
    // uncapped default.
    const cols = [5, 4, 3].find((c) => q.options.length % c === 0);
    if (cols) grid.style.setProperty('--cols', String(cols));

    q.options.forEach((o) => {
      const on = sel.has(o.id);
      const count = context.filter(o.match).length;

      const btn = el('button', `gk-option${on ? ' gk-option--on' : ''}${count === 0 && !on ? ' gk-option--empty' : ''}`);
      btn.type = 'button';
      btn.dataset.gkKey = `opt:${q.id}:${o.id}`;
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

/* --- the limits ----------------------------------------------------------- */
// `zeroSub` turns the sub-line vermilion, matching the want options: a choice
// that would leave nothing dims AND flags its count. The sort section's sub-line is a
// text hint rather than a count, so it never sets this.
function chip({ label, sub, on, empty, zeroSub, key, onClick }) {
  const btn = el('button', `gk-chip${on ? ' gk-chip--on' : ''}${empty ? ' gk-chip--empty' : ''}`);
  btn.type = 'button';
  if (key) btn.dataset.gkKey = key;
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
  // Memoised because two sections skip 'players': the count row and the fit row
  // ask the same question and were each paying for their own full pass.
  const ctxCache = new Map();
  const ctxFor = (skip) => {
    if (!ctxCache.has(skip)) ctxCache.set(skip, applyFilters(base, constraintPreds(c, skip)));
    return ctxCache.get(skip);
  };

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
        key: `chip:${sectionId}:${val}`,
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
          key: `chip:${SECTIONS.fit}:${val}`,
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
          key: `chip:${SECTIONS.weight}:${bk.key}`,
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
      valueRow('time', TIME_CAPS, c.maxTime, 'maxTime', (v) => `≤ ${v}m`, SECTIONS.time, (g, v) => {
        const t = timeOf(g);
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
      valueRow('age', [6, 8, 10, 12, 14], c.minAge, 'minAge', (v) => `${v}+`, SECTIONS.age, rank.fitsAge)
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
          key: `chip:${SECTIONS.sort}:${val}`,
          onClick: () => setState({ sortBy: val, pickId: null }),
        })
      );
    });
    out.appendChild(makeSection(SECTIONS.sort, 'What score settles the decision?', true, grid));
  }

  return out;
}

/* --- board ---------------------------------------------------------------- */
function buildBoard(ranked) {
  const main = el('main', 'gk-main');
  // Focusable but not a tab stop, so render() can land focus here after a view
  // swap. See restoreFocus.
  main.tabIndex = -1;
  // What this is, and what it will do about it. Both lived only in the <title>
  // and the meta description, where a tab shows about ten characters and nobody
  // reads the rest. Deliberately in the scroll area rather than the sticky
  // header: the header is already two rows on a phone, and an introduction has
  // done its job after the first screen.
  //
  // The second line is the one that makes this an introduction rather than a
  // slogan. On its own the tagline is a rhetorical question sitting above a real
  // one, which orients nobody; saying wants, then limits, then one game tells a
  // first-time visitor what the numbered sections below are for.
  //
  // The h1 is also the page's only one. The board had h2 section titles and no
  // h1 above them, so this closes that as well.
  //
  // It is a card, not loose text. Everything else on this board is a filled,
  // bordered object, so prose floating on the checkerboard had no mass in that
  // system and read as an orphan whatever size or colour it was set in. Given
  // the same treatment as an option chip it becomes a peer of them.
  //
  // The knight anchors it and is the only place the mark appears at a size you
  // can actually see, the header showing it at 27px.
  const intro = el('div', 'gk-intro');
  intro.appendChild(knightGlyph('gk-intro__mark'));
  const introText = el('div', 'gk-intro__text');
  introText.appendChild(el('h1', 'gk-lede', 'What should we play tonight?'));
  introText.appendChild(el('p', 'gk-lede__sub',
    'Say what you fancy, set what tonight allows, and it names one game.'));
  intro.appendChild(introText);
  main.appendChild(intro);
  main.appendChild(renderShelves());
  main.appendChild(renderWants());
  main.appendChild(renderLimits());

  const bar = el('div', 'gk-bar');
  const inner = el('div', 'gk-bar__inner');
  const deal = el('button', 'gk-deal');
  deal.type = 'button';
  deal.dataset.gkKey = 'deal';
  deal.appendChild(el('span', null, 'Make the move'));
  // Was the ♞ character, which after the logo landed meant the page showed two
  // different knights. Same artwork as the header now, and no font dependency.
  deal.appendChild(knightGlyph('gk-deal__knight'));
  deal.disabled = ranked.length === 0;
  deal.onclick = () => {
    setState({ view: 'verdict' });
    window.scrollTo({ top: 0 });
  };
  inner.appendChild(deal);
  bar.appendChild(inner);
  return { main, bar };
}

/* --- verdict -------------------------------------------------------------- */
function buildVerdict(ranked) {
  const main = el('main', 'gk-main gk-main--verdict');
  main.tabIndex = -1;
  const hero = ranked.find((g) => g.id === state.pickId) || ranked[0];

  const actions = el('div', 'gk-vactions');
  const back = el('button', 'gk-vbtn');
  back.type = 'button';
  back.dataset.gkKey = 'vbtn:back';
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
    again.dataset.gkKey = 'vbtn:again';
    again.appendChild(el('span', null, 'Deal another'));
    again.appendChild(el('span', 'gk-vbtn__glyph', '↻'));
    again.onclick = () => {
      // A window over the ranking, not the whole shelf. Dealing uniformly from
      // everything that survived the limits threw the ranking away: measured
      // over 600 sessions of six taps, 37.6% of taps produced a game matching
      // one or none of five stated wants, average fit 1.89 of 5. Through the
      // window it is 0.0% and 3.73.
      //
      // A window rather than the top fit tier, which sounds better and is not:
      // with five wants answered the tier is often one or two games, so it
      // deals the same game repeatedly and reads as broken. The window inherits
      // whatever the tiers already decided, so it cannot cycle when the tier is
      // thin or wander when it is fat, and with nothing answered it degrades to
      // "one of the ten best", which is a perfectly good shuffle.
      const pool = ranked.slice(0, DEAL_WINDOW).filter((g) => !hero || g.id !== hero.id);
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
  text.appendChild(tagRow(hero, true, ranked));
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
    // the order; the sort metric only settles ties.
    const order = answeredWants() > 0 ? `fit, then ${byLabel}` : byLabel;
    head.appendChild(el('span', 'gk-shortlist__count', `${rest.length} · by ${order}`));
    sec.appendChild(head);

    const rows = el('div', 'gk-rows');
    rest.forEach((g) => {
      const btn = el('button', 'gk-row');
      btn.type = 'button';
      btn.dataset.gkKey = `row:${g.id}`;
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
// Everything outside the dialog, which has to stop being reachable while it is
// open. Toggled BEFORE the early return below, or the page stays inert forever
// the first time the sheet closes.
const OUTSIDE_THE_SHEET = ['.gk-skip', '.gk-header', '#gkRoot', '#gkBarRoot'];

function renderSheet() {
  const root = $('#gkSheetRoot');
  root.textContent = '';
  const g = state.sheetGame;
  // aria-modal="true" was a claim the page did not honour: the whole board
  // stayed tabbable and clickable behind the dialog, so Tab walked straight out
  // of it into controls the user could not see. inert takes the background out
  // of the tab order, out of the accessibility tree, and out of reach of the
  // pointer, in one attribute. Browsers without it fall back to the Tab trap
  // installed below.
  OUTSIDE_THE_SHEET.forEach((sel) => {
    const n = $(sel);
    if (n) n.inert = Boolean(g);
  });
  if (!g) return;

  const backdrop = el('div', 'gk-sheet-backdrop');
  // Dismiss on a click on the backdrop itself, but only when the press STARTED
  // there. A tall sheet scrolls now, so the backdrop has a scrollbar, and a
  // plain click handler treated dragging that as "clicked outside" and closed
  // the card mid-scroll. It did the same when a text selection that began on the
  // card happened to end off it.
  let pressedBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => {
    pressedBackdrop = e.target === backdrop && e.offsetX < backdrop.clientWidth;
  });
  backdrop.addEventListener('click', (e) => {
    if (pressedBackdrop && e.target === backdrop) setState({ sheetGame: null });
  });

  const sheet = el('div', 'gk-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', g.name);
  // Keeps Tab inside the card, and wraps at both ends.
  sheet.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll('button, a[href]')];
    if (!stops.length) return;
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
  });

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

/* ------------------------------------------------------- focus handover -- */
// Every control on the page is destroyed and rebuilt on each render, which
// dropped focus to <body>. For a keyboard or switch user that meant being thrown
// back toward the top of a document with over two hundred tab stops after every
// single selection, so answering two questions in a row was not realistically
// possible. Controls carry a stable key, and the rebuilt one is found again by
// it. This does not overturn the full-rebuild model the file header defends; it
// finishes it.
let lastView = null;

function restoreFocus(key) {
  // While the sheet is open it owns focus. renderSheet has just put it on the
  // close button, and taking it back would leave the user outside a dialog that
  // claims to be modal.
  if (state.sheetGame) return;
  // Whatever the user was on, or else whoever opened the sheet that just closed:
  // the close button has no key of its own, so without this, dismissing a game's
  // details dropped focus on the floor.
  const want = key || state.sheetOpener;
  state.sheetOpener = null;
  if (!want) return;
  const next = document.querySelector(`[data-gk-key="${CSS.escape(want)}"]`);
  // preventScroll is not optional. Without it the browser scrolls the restored
  // control into view, which fights both the keepY correction at the end of
  // render() and any guided scroll still in flight.
  if (next) next.focus({ preventScroll: true });
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
  // Read before anything is torn down. If the sheet is opening, this is the
  // control that opened it, and closing needs to hand focus back there.
  const focusKey = document.activeElement?.dataset?.gkKey || null;
  if (state.sheetGame && focusKey) state.sheetOpener = focusKey;

  // One sort per render, handed to everything that needs the ordering. The
  // header strip, the board's deal button and the verdict each used to sort the
  // survivors independently, which on the verdict meant running the identical
  // full sort twice in the same call stack.
  const ranked = sortGames(remaining());
  const built =
    state.view === 'board' ? buildBoard(ranked) : { main: buildVerdict(ranked), bar: null };

  // The header only follows you on the board; on the verdict it scrolls away.
  $('.gk-header').classList.toggle('gk-header--flat', state.view === 'verdict');

  // Point the source badge at whichever repo baked this data. Falls back to the
  // href in index.html when the bake predates the site block, so a fork that
  // has not re-fetched yet still has a working link.
  const repoUrl = state.data.site && state.data.site.repoUrl;
  if (repoUrl) $('.gk-gh').href = repoUrl;

  renderLive(ranked);
  root.replaceChildren(built.main);
  if (built.bar) barRoot.replaceChildren(built.bar);
  else barRoot.replaceChildren();
  renderSheet();
  // The introduction card is rebuilt on every state change, so the observer is
  // pointed at a node that no longer exists unless it is re-attached here.
  watchIntroMark();

  // A board/verdict swap has no counterpart control on the other side, so send
  // focus to the top of the new page rather than leaving it on <body>.
  //
  // Only on a real swap. The FIRST render also changes this value, from null,
  // and treating that as a swap moved focus into <main> on page load, which
  // silently skipped the whole header: the skip link stopped being the first tab
  // stop, which is the one thing a skip link has to be.
  if (state.view !== lastView) {
    const swapped = lastView !== null;
    lastView = state.view;
    if (swapped && !state.sheetGame) built.main.focus({ preventScroll: true });
  } else {
    restoreFocus(focusKey);
  }

  // Belt and braces: if the swap still moved us (a genuinely shorter page), put
  // it back, unless a guided scroll is mid-flight and owns the position.
  if (state.view === 'board' && !guide.progScroll && window.scrollY !== keepY) {
    window.scrollTo(0, keepY);
  }
}

/* ------------------------------------------------------- knight hand-off -- */
// The header knight stays out of the way while the introduction card is showing
// its own. When that scrolls off, this one takes over.
//
// Watching the card's mark rather than the card itself, so the swap happens at
// the moment the big knight actually leaves rather than when the last line of
// text does. rootMargin pulls the trigger line down past the sticky header, or
// the hand-off would fire while the card is still visible underneath it.
let markWatcher = null;

function watchIntroMark() {
  const header = $('.gk-mark');
  if (!header) return;
  if (markWatcher) markWatcher.disconnect();

  // The verdict has no introduction card, so there is nothing to defer to.
  const introMark = $('.gk-intro__mark');
  if (!introMark || typeof IntersectionObserver !== 'function') {
    header.classList.remove('gk-mark--tucked');
    return;
  }

  markWatcher = new IntersectionObserver(
    ([entry]) => header.classList.toggle('gk-mark--tucked', entry.isIntersecting),
    { rootMargin: `-${headerH()}px 0px 0px 0px`, threshold: 0 }
  );
  markWatcher.observe(introMark);
}

/* ----------------------------------------------------------------- boot -- */
// A failed load used to print one line and stop, which on a phone that dipped
// out of signal for a second meant the app was dead until you found the reload
// control. An installed standalone copy has no reload control at all: no address
// bar, no pull-to-refresh on every platform, nothing. So the message carries the
// button now.
function showBootError(message) {
  const box = el('div', 'gk-loading');
  box.appendChild(el('div', null, `Could not load the shelf. ${message}`));
  const retry = el('button', 'gk-btn-outline gk-retry', 'Try again');
  retry.type = 'button';
  // boot() opens with render(), which paints the loading line, so a retry
  // already shows that it is doing something. A second failure lands back here.
  retry.onclick = () => boot();
  box.appendChild(retry);
  $('#gkRoot').replaceChildren(box);
}

// Wiring that must happen exactly once. boot() is re-entrant now, and running
// this twice would stack a duplicate of every listener and a second idle timer.
let wired = false;
function wireUp() {
  if (wired) return;
  wired = true;

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

async function boot() {
  render();
  try {
    state.data = await loadData();
    state.selected = (state.data.collections || []).map((c) => c.id); // all shelves on
  } catch (e) {
    showBootError(e.message);
    return;
  }
  render();
  wireUp();
}

// Registering the worker is what makes the page installable, and it is what
// lets the shelf open with no signal. Deliberately after boot rather than
// before: the app must never wait on it, and a browser without service workers,
// or a page opened straight off the filesystem, simply carries on without one.
// See sw.js for why it refuses to serve a stale shelf.
function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // An unregistrable worker costs offline support and nothing else, so it is
    // not worth an error in the console of a page that otherwise works.
  });
}

boot();
registerWorker();
