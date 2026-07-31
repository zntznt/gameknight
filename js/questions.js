// questions.js — the "wants" (sections 01–04 of the board).
// =============================================================================
// This file IS the spec for what each answer filters on.
//
// RULES OF THE ENGINE (see js/data.js + js/app.js):
//   • Wants are optional. Nothing selected in a section = that section is
//     skipped; there is no separate "doesn't matter" control.
//   • Within a multi-select question, chosen options are OR'd together.
//   • Across questions, answers are AND'd together.
//   • Matching on categories/mechanics is case-insensitive SUBSTRING, so a
//     needle like "Draft" matches "Card Drafting", "Open Drafting", etc.
//   • `g.cooperative` is precomputed by the fetcher from the "Cooperative Game"
//     mechanic.
// =============================================================================

// --- matching helpers -------------------------------------------------------
const norm = (s) => (s || '').toLowerCase();
const anyIncludes = (arr, needles) =>
  Array.isArray(arr) && arr.some((v) => needles.some((n) => norm(v).includes(norm(n))));
const cat = (g, ...needles) => anyIncludes(g.categories, needles);
const mech = (g, ...needles) => anyIncludes(g.mechanics, needles);

// Shared "shape" predicates reused across questions.
const isTeam = (g) => mech(g, 'Team-Based');
const isTraitor = (g) => mech(g, 'Hidden Roles', 'Traitor', 'Semi-Cooperative');
const isParty = (g) =>
  cat(g, 'Party Game', 'Word Game', 'Humor', 'Trivia', 'Music') ||
  mech(g, 'Acting', 'Singing', 'Storytelling', 'Voting') ||
  g.maxPlayers >= 6;
const isConfrontational = (g) =>
  cat(g, 'Wargame', 'Fighting', 'Modern Warfare', 'World War', 'Civil War', 'Vietnam War', 'Napoleonic', 'Pike and Shot') ||
  mech(g, 'Area Majority', 'Player Elimination', 'Take That', 'Area Movement', 'Battle', 'Combat', 'King of the Hill');

// =============================================================================
export const QUESTIONS = [
  // --- 01 · sides -----------------------------------------------------------
  {
    id: 'sides',
    kicker: 'sides',
    title: 'How are we drawing sides tonight?',
    type: 'single',
    options: [
      { id: 'coop', label: 'All cooperative', match: (g) => g.cooperative && !isTraitor(g) },
      { id: 'ffa', label: 'Free-for-all', match: (g) => !g.cooperative && !isTeam(g) && !isTraitor(g) },
      { id: 'teams', label: 'Teams', match: (g) => isTeam(g) },
      { id: 'traitor', label: 'Hidden traitor', match: (g) => isTraitor(g) },
    ],
  },

  // --- 02 · mood ------------------------------------------------------------
  {
    id: 'tone',
    kicker: 'mood',
    title: 'What mood are we bringing to the table?',
    type: 'single',
    options: [
      { id: 'thinky', label: 'Thinky & calm', match: (g) => !isConfrontational(g) && !isParty(g) },
      { id: 'party', label: 'Loud & social', match: (g) => isParty(g) },
      { id: 'cutthroat', label: 'Confrontational', match: (g) => isConfrontational(g) },
    ],
  },

  // --- 03 · world -----------------------------------------------------------
  {
    id: 'theme',
    kicker: 'flavour',
    title: 'What world are we stepping into?',
    type: 'multi',
    options: [
      { id: 'fantasy', label: 'Fantasy & adventure',
        match: (g) => cat(g, 'Fantasy', 'Adventure', 'Mythology', 'Exploration', 'Fairy Tale') },
      { id: 'scifi', label: 'Sci-fi & space',
        match: (g) => cat(g, 'Science Fiction', 'Space Exploration') },
      { id: 'history', label: 'History & civ',
        match: (g) => cat(g, 'Ancient', 'Medieval', 'Renaissance', 'Civilization', 'Prehistoric', 'Age of Reason', 'American West', 'Arabian', 'Post-Napoleonic', 'Political', 'Religious') },
      { id: 'war', label: 'War & conflict',
        match: (g) => cat(g, 'Wargame', 'World War', 'Modern Warfare', 'Civil War', 'Vietnam War', 'Napoleonic', 'Fighting', 'Pirates') },
      { id: 'economic', label: 'Economy & industry',
        match: (g) => cat(g, 'Economic', 'Industry / Manufacturing', 'City Building', 'Territory Building', 'Trains', 'Transportation', 'Farming') },
      { id: 'nature', label: 'Nature & animals',
        match: (g) => cat(g, 'Animals', 'Environmental', 'Farming', 'Nautical') },
      { id: 'mystery', label: 'Horror & mystery',
        match: (g) => cat(g, 'Horror', 'Zombies', 'Murder', 'Mystery', 'Spies', 'Mafia', 'Deduction', 'Medical') },
      { id: 'abstract', label: 'Cards & abstract',
        match: (g) => cat(g, 'Abstract Strategy', 'Card Game', 'Number', 'Puzzle', 'Maze', 'Math', 'Educational') },
      { id: 'party', label: 'Party & pop-culture',
        match: (g) => cat(g, 'Party Game', 'Humor', 'Word Game', 'Trivia', 'Music', 'Movies / TV / Radio theme', 'Video Game Theme', 'Comic Book', 'Novel-based', 'Book') },
      { id: 'sport', label: 'Sports & racing',
        match: (g) => cat(g, 'Sports', 'Racing', 'Aviation / Flight', 'Travel') },
    ],
  },

  // --- 04 · mechanics -------------------------------------------------------
  {
    id: 'mechanism',
    kicker: 'mechanism',
    title: 'What mechanics are we craving?',
    type: 'multi',
    options: [
      { id: 'engine', label: 'Build an engine',
        match: (g) => mech(g, 'Engine Building', 'Income', 'Tableau', 'Automatic Resource Growth') },
      { id: 'cards', label: 'Cards & deck-building',
        match: (g) => mech(g, 'Deck Construction', 'Deck, Bag', 'Deck Building', 'Hand Management', 'Multi-Use Card', 'Card Play', 'Drafting') },
      { id: 'worker', label: 'Worker placement',
        match: (g) => mech(g, 'Worker Placement', 'Action Points', 'Action Retrieval', 'Action Drafting') },
      { id: 'area', label: 'Area control & routes',
        match: (g) => mech(g, 'Area Majority', 'Area Movement', 'Enclosure', 'Network and Route', 'Area-Impulse') },
      { id: 'tile', label: 'Tile-laying & spatial',
        match: (g) => mech(g, 'Tile Placement', 'Pattern Building', 'Modular Board', 'Grid Coverage', 'Hexagon Grid') },
      { id: 'dice', label: 'Dice & push-your-luck',
        match: (g) => mech(g, 'Dice Rolling', 'Push Your Luck', 'Die Icon', 'Different Dice', 'Re-rolling') },
      { id: 'write', label: 'Roll / flip & write',
        match: (g) => mech(g, 'Paper-and-Pencil', 'Flip and Write') },
      { id: 'deduce', label: 'Deduction & bluffing',
        match: (g) => mech(g, 'Deduction', 'Betting and Bluffing', 'Hidden Movement', 'Voting', 'Player Judge') || cat(g, 'Bluffing', 'Deduction') },
      { id: 'trade', label: 'Negotiation & trading',
        match: (g) => mech(g, 'Negotiation', 'Trading', 'Auction', 'Bidding', 'Market', 'Stock', 'Commodity', 'Loans') || cat(g, 'Negotiation') },
      { id: 'campaign', label: 'Campaign / legacy / story',
        match: (g) => mech(g, 'Legacy', 'Campaign', 'Scenario', 'Mission', 'Narrative', 'Storytelling', 'Role Playing', 'Paragraph') },
      { id: 'dex', label: 'Dexterity & real-time',
        match: (g) => mech(g, 'Flicking', 'Stacking and Balancing', 'Real-Time', 'Speed Matching', 'Line Drawing', 'Slide/Push') || cat(g, 'Action / Dexterity', 'Real-time') },
      { id: 'trick', label: 'Trick-taking',
        match: (g) => mech(g, 'Trick-taking', 'Ladder Climbing', 'Melding') },
    ],
  },
];

// Complexity buckets for section 07. Half-open [lo, hi) so none overlap;
// unrated weight (0) passes every bucket.
export const WEIGHT_BUCKETS = [
  { key: 'any', label: 'Any', sub: '', lo: 0, hi: 99 },
  { key: 'light', label: 'Light', sub: 'gateway', lo: 0, hi: 2.0 },
  { key: 'medlight', label: 'Medium-light', sub: '2.0–2.5', lo: 2.0, hi: 2.5 },
  { key: 'med', label: 'Medium', sub: '2.5–3.0', lo: 2.5, hi: 3.0 },
  { key: 'heavy', label: 'Heavy', sub: '3.0–4.0', lo: 3.0, hi: 4.0 },
  { key: 'melt', label: 'Brain-melter', sub: '4.0+', lo: 4.0, hi: 99 },
];
