// questions.js — the preference "flowchart".
//
// These are WANTS, asked before the hard constraints. Every question is
// skippable ("Doesn't matter"), because a want is not a requirement.
// Each option carries a `match(game)` predicate. The engine ANDs together
// the answered questions and ORs together multi-select options within one.
//
// Editing this file is how you reshape the flowchart — add/remove questions,
// tweak wording, or change what each answer filters on. No build step needed.

// --- small matching helpers -------------------------------------------------
const norm = (s) => (s || '').toLowerCase();
const has = (arr, ...needles) =>
  Array.isArray(arr) &&
  arr.some((v) => needles.some((n) => norm(v).includes(norm(n))));

const hasCat = (g, ...names) => has(g.categories, ...names);
const hasMech = (g, ...names) => has(g.mechanics, ...names);

// A game is "confrontational" if it leans area control / wargame / take-that.
const isConfrontational = (g) =>
  hasCat(g, 'Wargame', 'Fighting', 'Negotiation', 'Political') ||
  hasMech(g, 'Area Majority', 'Player Elimination', 'Take That', 'Area Movement', 'Battle');

const isPartyish = (g) =>
  hasCat(g, 'Party Game', 'Word Game', 'Humor', 'Deduction') ||
  g.maxPlayers >= 6;

// --- the flowchart ----------------------------------------------------------
export const QUESTIONS = [
  {
    id: 'coop',
    title: 'Team up, or take each other down?',
    subtitle: 'The core social contract for tonight.',
    type: 'single',
    options: [
      { id: 'coop', label: '🤝 Cooperative', hint: 'Beat the game together', match: (g) => g.cooperative },
      { id: 'competitive', label: '⚔️ Competitive', hint: 'Every player for themselves', match: (g) => !g.cooperative },
    ],
  },
  {
    id: 'energy',
    title: "What's the table energy?",
    subtitle: 'Sets the mood more than the rules.',
    type: 'single',
    options: [
      { id: 'chill', label: '🧠 Chill & thinky', hint: 'Quiet, build-your-own-thing', match: (g) => !isConfrontational(g) && !isPartyish(g) },
      { id: 'social', label: '🎉 Loud & social', hint: 'Party energy, big group', match: (g) => isPartyish(g) },
      { id: 'cutthroat', label: '🔥 Tense & cutthroat', hint: 'Direct conflict, take-that', match: (g) => isConfrontational(g) },
    ],
  },
  {
    id: 'theme',
    title: 'Pick a flavour (or a few)',
    subtitle: 'The setting you feel like tonight.',
    type: 'multi',
    options: [
      { id: 'fantasy', label: '🐉 Fantasy', match: (g) => hasCat(g, 'Fantasy', 'Adventure', 'Mythology') },
      { id: 'scifi', label: '🚀 Sci-fi & space', match: (g) => hasCat(g, 'Science Fiction', 'Space') },
      { id: 'history', label: '🏛️ History & civ', match: (g) => hasCat(g, 'Ancient', 'Medieval', 'Civilization', 'Renaissance', 'Napoleonic', 'World War') },
      { id: 'economic', label: '💰 Economy & building', match: (g) => hasCat(g, 'Economic', 'City Building', 'Industry', 'Territory Building', 'Trains') },
      { id: 'nature', label: '🦉 Nature & animals', match: (g) => hasCat(g, 'Animals', 'Environmental', 'Farming') },
      { id: 'mystery', label: '🕵️ Mystery & horror', match: (g) => hasCat(g, 'Horror', 'Murder', 'Mystery', 'Deduction', 'Spies') },
      { id: 'abstract', label: '🔷 Abstract', match: (g) => hasCat(g, 'Abstract') },
      { id: 'party', label: '🥳 Party & words', match: (g) => hasCat(g, 'Party Game', 'Word Game', 'Humor') },
    ],
  },
  {
    id: 'mechanic',
    title: 'Any mechanism you’re craving?',
    subtitle: 'The "how" of the game. Optional — pick any that appeal.',
    type: 'multi',
    options: [
      { id: 'deckbuild', label: '🃏 Deck / card building', match: (g) => hasMech(g, 'Deck', 'Card Draft', 'Hand Management') },
      { id: 'worker', label: '👷 Worker placement', match: (g) => hasMech(g, 'Worker Placement', 'Action Points') },
      { id: 'engine', label: '⚙️ Engine building', match: (g) => hasMech(g, 'Engine Building', 'Income', 'Set Collection') },
      { id: 'dice', label: '🎲 Dice & push-luck', match: (g) => hasMech(g, 'Dice Rolling', 'Push Your Luck') },
      { id: 'tile', label: '🧩 Tile / area', match: (g) => hasMech(g, 'Tile Placement', 'Pattern Building', 'Area Majority') },
      { id: 'write', label: '✏️ Roll / flip & write', match: (g) => hasMech(g, 'Flip and Write', 'Paper-and-Pencil', 'Roll') },
      { id: 'campaign', label: '📖 Legacy / campaign', match: (g) => hasMech(g, 'Legacy', 'Campaign') },
      { id: 'social', label: '🗣️ Bluff & deduction', match: (g) => hasMech(g, 'Deduction', 'Voting', 'Communication', 'Negotiation') },
    ],
  },
];
