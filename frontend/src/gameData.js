// Mirrors backend/src/game/config.js + roles.js metadata, for lobby-side
// live validation/UX only. The server is always the source of truth and
// re-validates everything — this just avoids a network round-trip to tell
// the host "Morgana needs Percival" while they're clicking checkboxes.

export const MISSION_CONFIG = {
  5: { teamSizes: [2, 3, 2, 3, 3], failsRequired: [1, 1, 1, 1, 1], good: 3, evil: 2 },
  6: { teamSizes: [2, 3, 4, 3, 4], failsRequired: [1, 1, 1, 1, 1], good: 4, evil: 2 },
  7: { teamSizes: [2, 3, 3, 4, 4], failsRequired: [1, 1, 1, 2, 1], good: 4, evil: 3 },
  8: { teamSizes: [3, 4, 4, 5, 5], failsRequired: [1, 1, 1, 2, 1], good: 5, evil: 3 },
  9: { teamSizes: [3, 4, 4, 5, 5], failsRequired: [1, 1, 1, 2, 1], good: 6, evil: 3 },
  10: { teamSizes: [3, 4, 4, 5, 5], failsRequired: [1, 1, 1, 2, 1], good: 6, evil: 4 },
};

export const ROLE_TOGGLES = [
  {
    key: 'merlin',
    name: 'Merlin',
    team: 'good',
    description: 'Sees all Evil (except Mordred). The Assassin can win by unmasking him at the end.',
  },
  {
    key: 'gawain',
    name: 'Gawain',
    team: 'good',
    description:
      'A plain knight with no special knowledge. If the Assassin mistakes you for Merlin and names you, you win the game for yourself — a third outcome, neither Good’s nor Evil’s.',
  },
  {
    key: 'percival',
    name: 'Percival',
    team: 'good',
    description: 'Sees Merlin — or, if Morgana is in play, two candidates for Merlin.',
  },
  {
    key: 'morgana',
    name: 'Morgana',
    team: 'evil',
    description: 'Appears to Percival as a possible Merlin. Requires Percival.',
  },
  {
    key: 'mordred',
    name: 'Mordred',
    team: 'evil',
    description: 'Hidden from Merlin’s sight. Requires Merlin.',
  },
  {
    key: 'oberon',
    name: 'Oberon',
    team: 'evil',
    description: 'Unknown to the other Evil players, and they are unknown to him.',
  },
  {
    key: 'assassin',
    name: 'Assassin',
    team: 'evil',
    description:
      'Gets one shot at naming who you believe is Merlin (or the Tristan & Iseult pair) if Good wins 3 missions. Guess right and Evil steals the win — but if Gawain is in play and you mistake him for Merlin, he wins the game for himself, not you. Requires Merlin, Gawain, or the Tristan & Iseult pair to be in play.',
  },
  {
    key: 'tristanIseult',
    name: 'Tristan & Iseult',
    team: 'good',
    description: 'A pair of Loyal Servants who know each other’s identity from the start.',
  },
  {
    key: 'agravain',
    name: 'Agravain',
    team: 'evil',
    description: 'A zealous Minion of Mordred who must play Fail on every quest they’re sent on — no choice.',
  },
  {
    key: 'arthur',
    name: 'Arthur',
    team: 'good',
    description: 'May publicly reveal themselves once 2 quests have failed, to rally Good.',
  },
  {
    key: 'lancelot',
    name: 'Lancelot',
    team: 'good',
    description:
      'If Merlin is in play, appears to him as Evil — otherwise this passes quietly. Holds a single Reverse card to flip one quest’s outcome. Cannot be combined with the Lancelot pair below.',
  },
  {
    key: 'lancelotPair',
    name: 'Good & Evil Lancelot (pair)',
    team: 'mixed',
    description:
      'Two Lancelots — one starts Good, one starts Evil — who secretly swap allegiance at a random point in the game. If Merlin is in play, only the one currently Evil at the start appears to him as Evil — the Good one does not. Cannot be combined with solo Lancelot above.',
  },
  {
    key: 'guinevere',
    name: 'Guinevere',
    team: 'good',
    description: 'Knows both Lancelots’ identities, but never which is currently Good or Evil. Requires the Lancelot pair.',
  },
];

// Game-flow modifiers rather than characters — they don't take up a
// good/evil slot, so they're shown as a separate section in the lobby.
export const EXTENSION_TOGGLES = [
  {
    key: 'ladyOfLake',
    name: 'Lady of the Lake',
    description:
      'After missions 2, 3 and 4, the current holder secretly checks one other player’s loyalty, then passes the token to them. Can go to anyone, Good or Evil.',
  },
  {
    key: 'excalibur',
    name: 'Excalibur',
    description:
      'Each team’s leader hands Excalibur to someone else on that team before the vote — everyone sees who. Once the quest’s cards are in, the holder secretly views one selected player’s card and may flip it, once per game.',
  },
];

// Purely cosmetic flavor for each of the 5 quests, in the order requested --
// a loose Arthurian arc from gathering the company through to the isle
// where the legend ends. Indexed 0-4 to match game.missionNumber directly.
// `theme` keys a background motif (see QuestThemeArt.jsx) applied to the
// whole page while that quest is current, and to the quest-result modal
// for whichever quest it's displaying -- purely decorative, never the
// source of truth for anything (missionNumber already is).
export const QUEST_FLAVOR = [
  { name: 'The Round Table', blurb: 'The knights gather to choose who rides out first.', theme: 'round-table' },
  { name: 'Camelot', blurb: "Word of the quest's early turns spreads through the court.", theme: 'camelot' },
  { name: 'The Holy Grail', blurb: 'The company presses on toward its most sacred goal.', theme: 'holy-grail' },
  { name: 'Camlann', blurb: 'Old loyalties fracture on the field where legends end.', theme: 'camlann' },
  { name: 'The Isle of Avalon', blurb: 'The final crossing — where the truth is finally laid bare.', theme: 'isle-of-avalon' },
];

// How many of a player-count's Good/Evil slots are claimed by the
// currently-enabled special roles. Tristan & Iseult and the Good & Evil
// Lancelot pair each represent two real seats, not one -- weighted
// accordingly here so every caller (the post-hoc error message below, and
// the lobby's proactive per-toggle cap) agrees on the same count instead
// of two formulas quietly drifting apart.
export function specialSlotCounts(settings) {
  const evilSpecial =
    ['mordred', 'morgana', 'oberon', 'assassin', 'agravain'].filter((k) => settings[k]).length +
    (settings.lancelotPair ? 1 : 0);
  const goodSpecial =
    (settings.tristanIseult ? 2 : 0) +
    (settings.merlin ? 1 : 0) +
    (settings.percival ? 1 : 0) +
    (settings.arthur ? 1 : 0) +
    (settings.gawain ? 1 : 0) +
    (settings.lancelot ? 1 : 0) +
    (settings.lancelotPair ? 1 : 0) +
    (settings.guinevere ? 1 : 0);
  return { evilSpecial, goodSpecial };
}

export function validateSettingsClient(playerCount, settings) {
  const errors = [];
  const cfg = MISSION_CONFIG[playerCount];
  if (!cfg) {
    errors.push(`Need 5–10 players to start (have ${playerCount}).`);
    return errors;
  }
  if (settings.assassin && !(settings.merlin || settings.gawain || settings.tristanIseult))
    errors.push('The Assassin needs at least one valid target in play: Merlin, Gawain, or the Tristan & Iseult pair.');
  if (settings.percival && !settings.merlin) errors.push('Percival requires Merlin to be in play.');
  if (settings.morgana && !settings.percival) errors.push('Morgana requires Percival to be in play.');
  if (settings.mordred && !settings.merlin) errors.push('Mordred requires Merlin to be in play.');
  // Lancelot (solo or the pair) does NOT require Merlin -- see the same
  // note in roles.py's validate_settings, which this mirrors.
  if (settings.guinevere && !settings.lancelotPair) errors.push('Guinevere requires the Good & Evil Lancelot pair to be in play.');
  if (settings.lancelot && settings.lancelotPair) errors.push('Lancelot (solo) and the Lancelot pair cannot both be in play — pick one.');

  const { evilSpecial, goodSpecial } = specialSlotCounts(settings);
  if (evilSpecial > cfg.evil) errors.push(`Too many Evil special roles for ${cfg.evil} Evil slots at ${playerCount} players.`);
  if (goodSpecial > cfg.good) errors.push(`Too many Good special roles for ${cfg.good} Good slots at ${playerCount} players.`);

  return errors;
}

// Would enabling this one currently-off toggle, on its own, push either
// team's special-role count past what this player count has slots for?
// Used to proactively greyed out the toggle itself in the lobby, rather
// than only surfacing the problem after the fact via
// validateSettingsClient's error list once the host has already picked an
// over-count combination. Already-enabled toggles are never blocked by
// this (turning one off can only ever free up slots, never use more).
export function togglingWouldExceedSlots(playerCount, settings, key) {
  const cfg = MISSION_CONFIG[playerCount];
  if (!cfg || settings[key]) return false;
  const { evilSpecial, goodSpecial } = specialSlotCounts({ ...settings, [key]: true });
  return evilSpecial > cfg.evil || goodSpecial > cfg.good;
}

// Same idea as the slot cap above, but for characters that only make sense
// once another one is already in play (Morgana has nothing to fool without
// Percival; Mordred nothing to hide from without Merlin; ...) -- mirrors
// the same "requires" checks in validateSettingsClient/roles.py's
// validate_settings, just phrased as "what's this waiting on" so the lobby
// can grey the toggle out *before* the host picks an invalid combination,
// not just flag it after. `any: true` means any one of `requires` will do
// (the Assassin just needs *a* target, not all three). Lancelot/
// lancelotPair aren't here -- they don't require Merlin (see the note in
// validateSettingsClient above); Merlin being in play just changes what
// they look like to him, it isn't a prerequisite for playing them at all.
const ROLE_DEPENDENCIES = {
  percival: { requires: ['merlin'], label: 'Merlin' },
  morgana: { requires: ['percival'], label: 'Percival' },
  mordred: { requires: ['merlin'], label: 'Merlin' },
  guinevere: { requires: ['lancelotPair'], label: 'the Good & Evil Lancelot pair' },
  assassin: {
    requires: ['merlin', 'gawain', 'tristanIseult'],
    any: true,
    label: 'Merlin, Gawain, or the Tristan & Iseult pair',
  },
};

// Returns a human-readable label for this toggle's still-missing
// dependency, or null if it has none (or its dependency is already
// satisfied). Only meaningful for a currently-off toggle -- an
// already-enabled one keeps working even if its dependency gets turned off
// later (validateSettingsClient still catches that combination and blocks
// starting, same as before; this only gates *turning one on*).
export function unmetDependency(settings, key) {
  const dep = ROLE_DEPENDENCIES[key];
  if (!dep) return null;
  const satisfied = dep.any ? dep.requires.some((k) => settings[k]) : dep.requires.every((k) => settings[k]);
  return satisfied ? null : dep.label;
}

// The two plain roles that silently fill whatever Good/Evil slots the
// toggled specials leave over -- see roles.py's build_role_list, which
// this mirrors. Not part of ROLE_TOGGLES since the host can't pick them,
// but included in fullRoster() below so the footer can show the *whole*
// roster, not just which named characters are active.
const LOYAL_SERVANT = {
  key: 'loyalServant',
  name: 'Loyal Servant of Arthur',
  team: 'good',
  description: 'A plain member of Arthur’s court. No special knowledge — vote wisely and watch the table.',
};
const MINION = {
  key: 'minion',
  name: 'Minion of Mordred',
  team: 'evil',
  description: 'A plain servant of Evil. Knows its fellow Minions (except Oberon) — sabotage missions without getting caught.',
};

// The full roster that will actually be dealt at this player count: every
// toggled special character (weighted 2 seats for Tristan & Iseult and the
// Lancelot pair, same weighting as specialSlotCounts) plus however many
// plain Loyal Servants / Minions fill the rest. `good`/`evil` are the
// player count's fixed total split either way, straight from
// MISSION_CONFIG -- simpler and always right, rather than re-deriving it
// from the roster items (the Lancelot pair's `team: 'mixed'` would make
// summing item counts by team error-prone). Returns null for an
// unsupported player count.
export function fullRoster(playerCount, settings) {
  const cfg = MISSION_CONFIG[playerCount];
  if (!cfg) return null;
  const items = ROLE_TOGGLES.filter((r) => settings[r.key]).map((r) => ({
    ...r,
    count: r.key === 'tristanIseult' || r.key === 'lancelotPair' ? 2 : 1,
  }));
  const { evilSpecial, goodSpecial } = specialSlotCounts(settings);
  const loyalServants = cfg.good - goodSpecial;
  const minions = cfg.evil - evilSpecial;
  if (loyalServants > 0) items.push({ ...LOYAL_SERVANT, count: loyalServants });
  if (minions > 0) items.push({ ...MINION, count: minions });
  return { items, good: cfg.good, evil: cfg.evil };
}
