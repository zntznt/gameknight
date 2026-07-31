// data.js — load the baked collection data and expose pool/filter helpers.

export async function loadData() {
  const res = await fetch('./data/games.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load games.json (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data.games)) throw new Error('games.json is malformed');
  return data;
}

// The pool is the union of the selected shelves: a game is in play if anyone
// selected owns it. (The old "everyone owns" intersection mode is gone.)
export function poolFor(data, selectedIds) {
  const sel = new Set(selectedIds);
  if (!data || sel.size === 0) return [];
  return data.games.filter((g) => (g.owners || []).some((o) => sel.has(o)));
}

// Apply an array of predicate fns (nulls ignored). Returns the surviving games.
export function applyFilters(games, predicates) {
  const active = predicates.filter(Boolean);
  if (active.length === 0) return games.slice();
  return games.filter((g) => active.every((p) => p(g)));
}

// Turn one question's selected option ids into a single predicate (or null).
// Nothing selected → null → that question doesn't filter at all.
export function questionPredicate(question, selectedIds) {
  const ids = selectedIds || [];
  if (ids.length === 0) return null;
  const chosen = question.options.filter((o) => ids.includes(o.id));
  if (chosen.length === 0) return null;
  if (question.type === 'single') return chosen[0].match;
  return (g) => chosen.some((o) => o.match(g));
}
