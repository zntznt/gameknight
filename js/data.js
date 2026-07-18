// data.js — load the baked collection data and expose pool/filter helpers.

export async function loadData() {
  const res = await fetch('./data/games.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load games.json (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data.games)) throw new Error('games.json is malformed');
  return data;
}

// Combine the selected collections into a base pool.
//   union        -> games owned by ANY selected collection
//   intersection -> games owned by ALL selected collections (the "we can all play" set)
export function poolFor(data, selectedIds, mode) {
  const sel = new Set(selectedIds);
  if (sel.size === 0) return [];
  return data.games.filter((g) => {
    const owned = (g.owners || []).filter((o) => sel.has(o));
    return mode === 'intersection' ? owned.length === sel.size : owned.length > 0;
  });
}

// Apply an array of predicate fns (nulls ignored). Returns the surviving games.
export function applyFilters(games, predicates) {
  const active = predicates.filter(Boolean);
  if (active.length === 0) return games.slice();
  return games.filter((g) => active.every((p) => p(g)));
}

// Turn one question's selected option ids into a single predicate (or null).
export function questionPredicate(question, selectedIds) {
  const ids = selectedIds || [];
  if (ids.length === 0) return null; // skipped / doesn't matter
  const chosen = question.options.filter((o) => ids.includes(o.id));
  if (chosen.length === 0) return null;
  if (question.type === 'single') return chosen[0].match;
  // multi: game matches if it satisfies ANY chosen option
  return (g) => chosen.some((o) => o.match(g));
}
