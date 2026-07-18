// questions.js — Gameknight's picker, fully specified.
// =============================================================================
// This file IS the spec. Every answer below documents exactly which BGG field
// (or category / mechanic string) it filters on, so there are no open questions
// about what any button does.
//
// RULES OF THE ENGINE (see js/data.js + js/app.js):
//   • Preferences are WANTS, asked first, and every one is skippable.
//   • Within a multi-select question, chosen options are OR'd together.
//   • Across questions, answers are AND'd together.
//   • Matching on categories/mechanics is case-insensitive SUBSTRING, so a
//     needle like "Draft" matches "Card Drafting", "Open Drafting", etc.
//   • `g.cooperative` is precomputed by the fetcher from the "Cooperative Game"
//     mechanic.
//
// THE FLOW:
//   Preferences (this file):   1. Sides  2. Tone  3. Theme  4. Mechanism
//   Constraints (app.js):      Players · Complexity · Time · Youngest player
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
  // ---------------------------------------------------------------------------
  // 1. SIDES — how are sides drawn? The core social contract.
  // ---------------------------------------------------------------------------
  {
    id: 'sides',
    title: 'How are sides drawn tonight?',
    subtitle: 'The core social contract.',
    type: 'single',
    options: [
      { id: 'coop', label: '🤝 All cooperative', hint: 'Beat the game together',
        match: (g) => g.cooperative && !isTraitor(g) },
      { id: 'ffa', label: '⚔️ Free-for-all', hint: 'Everyone for themselves',
        match: (g) => !g.cooperative && !isTeam(g) && !isTraitor(g) },
      { id: 'teams', label: '👥 Teams', hint: 'Play as sides',
        match: (g) => isTeam(g) },
      { id: 'traitor', label: '🎭 Hidden traitor', hint: "Someone's secretly against you",
        match: (g) => isTraitor(g) },
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. TONE — the table's emotional temperature (independent of rules weight).
  // ---------------------------------------------------------------------------
  {
    id: 'tone',
    title: "What's the mood at the table?",
    subtitle: 'Sets the vibe more than the rulebook does.',
    type: 'single',
    options: [
      { id: 'thinky', label: '🧠 Thinky & calm', hint: 'Build your own thing, low conflict',
        match: (g) => !isConfrontational(g) && !isParty(g) },
      { id: 'party', label: '🎉 Loud & social', hint: 'Party energy, laughs, big group',
        match: (g) => isParty(g) },
      { id: 'cutthroat', label: '🔥 Confrontational', hint: 'Attacks, area fights, take-that',
        match: (g) => isConfrontational(g) },
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. THEME — the setting. Multi-select (OR). Buckets cover the whole BGG
  //    boardgamecategory vocabulary.
  // ---------------------------------------------------------------------------
  {
    id: 'theme',
    title: 'Pick a flavour (or a few)',
    subtitle: 'The world you feel like stepping into.',
    type: 'multi',
    options: [
      { id: 'fantasy', label: '🐉 Fantasy & adventure',
        match: (g) => cat(g, 'Fantasy', 'Adventure', 'Mythology', 'Exploration', 'Fairy Tale') },
      { id: 'scifi', label: '🚀 Sci-fi & space',
        match: (g) => cat(g, 'Science Fiction', 'Space Exploration') },
      { id: 'history', label: '🏛️ History & civ',
        match: (g) => cat(g, 'Ancient', 'Medieval', 'Renaissance', 'Civilization', 'Prehistoric', 'Age of Reason', 'American West', 'Arabian', 'Post-Napoleonic', 'Political', 'Religious') },
      { id: 'war', label: '💥 War & conflict',
        match: (g) => cat(g, 'Wargame', 'World War', 'Modern Warfare', 'Civil War', 'Vietnam War', 'Napoleonic', 'Fighting', 'Pirates') },
      { id: 'economic', label: '💰 Economy & industry',
        match: (g) => cat(g, 'Economic', 'Industry / Manufacturing', 'City Building', 'Territory Building', 'Trains', 'Transportation', 'Farming') },
      { id: 'nature', label: '🦉 Nature & animals',
        match: (g) => cat(g, 'Animals', 'Environmental', 'Farming', 'Nautical') },
      { id: 'mystery', label: '👻 Horror & mystery',
        match: (g) => cat(g, 'Horror', 'Zombies', 'Murder', 'Mystery', 'Spies', 'Mafia', 'Deduction', 'Medical') },
      { id: 'abstract', label: '🃏 Cards & abstract',
        match: (g) => cat(g, 'Abstract Strategy', 'Card Game', 'Number', 'Puzzle', 'Maze', 'Math', 'Educational') },
      { id: 'party', label: '🥳 Party & pop-culture',
        match: (g) => cat(g, 'Party Game', 'Humor', 'Word Game', 'Trivia', 'Music', 'Movies / TV / Radio theme', 'Video Game Theme', 'Comic Book', 'Novel-based', 'Book') },
      { id: 'sport', label: '🏎️ Sports & racing',
        match: (g) => cat(g, 'Sports', 'Racing', 'Aviation / Flight', 'Travel') },
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. MECHANISM — the "how". Multi-select (OR). Families cover the meaningful
  //    span of the BGG boardgamemechanic vocabulary.
  // ---------------------------------------------------------------------------
  {
    id: 'mechanism',
    title: 'Any way of playing you’re craving?',
    subtitle: 'Optional — pick any that sound fun.',
    type: 'multi',
    options: [
      { id: 'engine', label: '⚙️ Build an engine',
        match: (g) => mech(g, 'Engine Building', 'Income', 'Tableau', 'Automatic Resource Growth') },
      { id: 'cards', label: '🃏 Cards & deck-building',
        match: (g) => mech(g, 'Deck Construction', 'Deck, Bag', 'Deck Building', 'Hand Management', 'Multi-Use Card', 'Card Play', 'Drafting') },
      { id: 'worker', label: '👷 Worker placement',
        match: (g) => mech(g, 'Worker Placement', 'Action Points', 'Action Retrieval', 'Action Drafting') },
      { id: 'area', label: '🗺️ Area control & routes',
        match: (g) => mech(g, 'Area Majority', 'Area Movement', 'Enclosure', 'Network and Route', 'Area-Impulse') },
      { id: 'tile', label: '🧩 Tile-laying & spatial',
        match: (g) => mech(g, 'Tile Placement', 'Pattern Building', 'Modular Board', 'Grid Coverage', 'Hexagon Grid') },
      { id: 'dice', label: '🎲 Dice & push-your-luck',
        match: (g) => mech(g, 'Dice Rolling', 'Push Your Luck', 'Die Icon', 'Different Dice', 'Re-rolling') },
      { id: 'write', label: '✏️ Roll / flip & write',
        match: (g) => mech(g, 'Paper-and-Pencil', 'Flip and Write') },
      { id: 'deduce', label: '🕵️ Deduction & bluffing',
        match: (g) => mech(g, 'Deduction', 'Betting and Bluffing', 'Hidden Movement', 'Voting', 'Player Judge') || cat(g, 'Bluffing', 'Deduction') },
      { id: 'trade', label: '💬 Negotiation & trading',
        match: (g) => mech(g, 'Negotiation', 'Trading', 'Auction', 'Bidding', 'Market', 'Stock', 'Commodity', 'Loans') || cat(g, 'Negotiation') },
      { id: 'campaign', label: '📖 Campaign / legacy / story',
        match: (g) => mech(g, 'Legacy', 'Campaign', 'Scenario', 'Mission', 'Narrative', 'Storytelling', 'Role Playing', 'Paragraph') },
      { id: 'dex', label: '🎯 Dexterity & real-time',
        match: (g) => mech(g, 'Flicking', 'Stacking and Balancing', 'Real-Time', 'Speed Matching', 'Line Drawing', 'Slide/Push') || cat(g, 'Action / Dexterity', 'Real-time') },
      { id: 'trick', label: '🎴 Trick-taking',
        match: (g) => mech(g, 'Trick-taking', 'Ladder Climbing', 'Melding') },
    ],
  },
];
