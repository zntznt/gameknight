// questions.js. The "wants": the numbered sections after the shelves.
// =============================================================================
// This file IS the spec for what each answer filters on.
//
// RULES OF THE ENGINE (see js/data.js + js/app.js):
//   • Wants SCORE, they do not eliminate. A game matching more of your answers
//     ranks higher; a game matching none still appears, just last. Only the
//     limits (the sections after the wants) actually remove games. This is the whole point
//     of the wants/limits split: "I fancy something fantasy" is a preference,
//     not "delete everything that isn't fantasy".
//   • Wants are optional. Nothing selected in a section = that section is
//     skipped; there is no separate "doesn't matter" control.
//   • Within a multi-select question, chosen options are OR'd together, so a
//     game matching any of them scores that question.
//   • Each answered question is worth one point, so no single question can
//     dominate by having more options selected.
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
//
// These describe qualities, and a game may legitimately have several: Pax Pamir
// is both thinky and confrontational. That overlap is fine because wants are
// scored rather than used to eliminate, so nothing is forced into one bucket.
const isTeam = (g) => mech(g, 'Team-Based');
const isTraitor = (g) => mech(g, 'Hidden Roles', 'Traitor', 'Semi-Cooperative');

// Two different solo questions, and conflating them was a real blind spot.
//
// isSoloOnly: the box seats exactly one. These games have no sides to draw, so
// they are kept out of "Free-for-all".
//
// playsSolo: can I play this ALONE tonight, which is what someone picking
// "Just me" is actually asking. Either signal counts, because each catches
// games the other misses: the box range catches Twilight Inscription and
// Libertalia, while BGG's solo tag catches Pandemic and Forbidden Island, whose
// well known solo variants the box's "2 players minimum" hides.
const isSoloOnly = (g) => g.maxPlayers === 1;
const playsSolo = (g) => g.minPlayers === 1 || mech(g, 'Solo / Solitaire');

// Does each player get their own faction, character or power set, or does
// everyone work with the same toolkit? Unlike the old "Thinky & calm", the
// negative side here is a genuine binary rather than a residual: a game either
// hands players different abilities or it does not.
const isAsymmetric = (g) =>
  mech(g, 'Variable Player Powers', 'Roles with Asymmetric Information', 'Different Worker Types');

// Party is about how the game FEELS, not how many chairs it has. Seating 6+ was
// previously enough to qualify, which labelled heavy euros like Hadrian's Wall
// and Twilight Inscription party games. Player count is the limits' job.
const isParty = (g) =>
  cat(g, 'Party Game', 'Word Game', 'Humor', 'Trivia', 'Music') ||
  mech(g, 'Acting', 'Singing', 'Storytelling', 'Player Judge');

// Conflict aimed AT other players. Two guards matter here:
//   • "Area Movement" and "Area Majority" are spatial mechanics that plenty of
//     peaceful euros use, so they are not triggers.
//   • A full co-op cannot be confrontational: you fight the game, not each
//     other. Without this, Spirit Island's "Fighting" category made it
//     confrontational and so disqualified it from "Thinky & calm".
const hasFightingSubject = (g) =>
  cat(g, 'Wargame', 'Fighting', 'Modern Warfare', 'World War', 'Civil War', 'Vietnam War', 'Napoleonic', 'Pike and Shot') ||
  mech(g, 'Player Elimination', 'Take That', 'Battle', 'Combat', 'King of the Hill');
const isConfrontational = (g) => hasFightingSubject(g) && (!g.cooperative || isTraitor(g));

// Defined by what it IS, not by what it is not. The old version was the
// leftovers after party and confrontational, so any over-eager rule in those
// two silently evicted games (Spirit Island lost it to "Area Majority").
const isThinky = (g) =>
  mech(
    g, 'Engine Building', 'Worker Placement', 'Tile Placement', 'Set Collection',
    'Drafting', 'Hand Management', 'Pattern Building', 'Income', 'Tableau',
    'Network and Route', 'Deck Construction', 'Deck, Bag', 'Grid Coverage',
    'Action Points', 'Variable Player Powers'
  ) ||
  cat(
    g, 'Abstract Strategy', 'Economic', 'City Building', 'Industry / Manufacturing',
    'Territory Building', 'Farming', 'Puzzle', 'Environmental'
  );

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
      // Only solo-ONLY games are held out here. A 1 to 4 player game like Ark
      // Nova is a perfectly good free-for-all that also happens to play alone,
      // and since wants score rather than filter, it can answer both.
      { id: 'ffa', label: 'Free-for-all', match: (g) => !g.cooperative && !isTeam(g) && !isTraitor(g) && !isSoloOnly(g) },
      { id: 'teams', label: 'Teams', match: (g) => isTeam(g) },
      { id: 'traitor', label: 'Hidden traitor', match: (g) => isTraitor(g) },
      { id: 'solo', label: 'Just me', match: playsSolo },
    ],
  },

  // --- 02 · mood ------------------------------------------------------------
  {
    id: 'tone',
    kicker: 'mood',
    title: 'What mood are we bringing to the table?',
    type: 'single',
    options: [
      { id: 'thinky', label: 'Thinky & calm', match: (g) => isThinky(g) && !isConfrontational(g) },
      { id: 'party', label: 'Loud & social', match: isParty },
      { id: 'cutthroat', label: 'Confrontational', match: isConfrontational },
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
      // Three cravings, not one. As a single option this matched 60% of the
      // shelf, so choosing it barely moved the ranking: it lumped together
      // building a deck, drafting from a pool, and simply having cards in hand,
      // which are different things people want on different nights.
      //
      // Hand Management is the reason it ballooned. It sits on 46% of the shelf,
      // on Ark Nova and A Feast for Odin as readily as on any card game, so it
      // is ambient rather than a craving and cannot carry an option by itself.
      // It earns its place below only where BGG also calls the game a card game,
      // which is what rescues pure card games like Sentinels of the Multiverse
      // and Boss Monster whose only other mechanic tag is Hand Management.
      { id: 'deckbuild', label: 'Deck & bag building',
        match: (g) => mech(g, 'Deck Construction', 'Deck, Bag') },
      { id: 'draft', label: 'Drafting & picking',
        match: (g) => mech(g, 'Drafting') },
      { id: 'cardplay', label: 'Playing a hand of cards',
        match: (g) =>
          mech(g, 'Multi-Use Cards', 'Card Play', 'Command Cards', 'Campaign / Battle Card', 'Move Through Deck') ||
          (mech(g, 'Hand Management') && cat(g, 'Card Game')) },
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
      // Replaced two options that could not do any work on this shelf:
      //
      //   "Trick-taking" matched exactly one game, and matched it WRONGLY: its
      //   'Melding' needle caught Expeditions via "Melding and Splaying". There
      //   is not a single real trick-taker here.
      //
      //   "Dexterity & real-time" matched two games, both already reachable
      //   through Dice and Tile-laying.
      //
      // These two carry their weight instead. Reinstate the old pair if your
      // shelf actually has those games; coverage does not depend on either.
      { id: 'sets', label: 'Set collection',
        match: (g) => mech(g, 'Set Collection', 'Contracts', 'Collection') },
      // 'Deck, Bag' used to sit here too, but it now belongs to "Deck & bag
      // building" above and having it in both made this option a partial copy
      // of that one. What is left is what genuinely changes between sessions:
      // the setup and the board.
      { id: 'variable', label: 'Different every time',
        match: (g) => mech(g, 'Variable Set-up', 'Modular Board') },
    ],
  },

  // --- 05 · roles ------------------------------------------------------------
  // Splits the shelf close to evenly (roughly 45/55), which makes it one of the
  // sharpest signals available, and it is a question people genuinely ask before
  // a game night: is everyone learning one set of rules, or five?
  {
    id: 'asymmetry',
    kicker: 'roles',
    title: 'Does everyone play by the same rules?',
    type: 'single',
    options: [
      { id: 'same', label: 'Same for everyone', match: (g) => !isAsymmetric(g) },
      { id: 'asym', label: 'Unique roles & factions', match: isAsymmetric },
    ],
  },
];

// Complexity buckets for section 07, ascending. Half-open [lo, hi) so none
// overlap, and unrated weight (0) passes every bucket.
//
// Note how these are USED: `hi` acts as a ceiling, not a band. Picking "Medium"
// keeps everything medium and lighter, because the question asks how much brain
// you are willing to spend. `lo` is only used to work out which band a game sits
// in, so games at the weight you asked for can rank above the lighter ones you
// would still accept. See weightFit in app.js.
export const WEIGHT_BUCKETS = [
  { key: 'any', label: 'Any', sub: '', lo: 0, hi: 99 },
  { key: 'light', label: 'Light', sub: 'gateway', lo: 0, hi: 2.0 },
  { key: 'medlight', label: 'Medium-light', sub: '2.0–2.5', lo: 2.0, hi: 2.5 },
  { key: 'med', label: 'Medium', sub: '2.5–3.0', lo: 2.5, hi: 3.0 },
  { key: 'heavy', label: 'Heavy', sub: '3.0–4.0', lo: 3.0, hi: 4.0 },
  { key: 'melt', label: 'Brain-melter', sub: '4.0+', lo: 4.0, hi: 99 },
];
