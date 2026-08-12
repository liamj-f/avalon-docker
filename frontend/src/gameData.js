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
    description: 'Gets one shot at naming Merlin if Good wins 3 missions. Requires Merlin.',
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
      'Appears to Merlin as Evil. Holds a single Reverse card to flip one quest’s outcome. Cannot be combined with the Lancelot pair below.',
  },
  {
    key: 'lancelotPair',
    name: 'Good & Evil Lancelot (pair)',
    team: 'mixed',
    description:
      'Two Lancelots — one starts Good, one starts Evil — who secretly swap allegiance at a random point in the game. Both appear to Merlin as Evil. Cannot be combined with solo Lancelot above.',
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
      'Each team’s leader hands Excalibur to someone else on that team before the vote — everyone sees who. Once the quest’s cards are in, the holder sees every real card and may flip exactly one player’s card, once per game.',
  },
];

export function validateSettingsClient(playerCount, settings) {
  const errors = [];
  const cfg = MISSION_CONFIG[playerCount];
  if (!cfg) {
    errors.push(`Need 5–10 players to start (have ${playerCount}).`);
    return errors;
  }
  if (settings.assassin && !settings.merlin) errors.push('The Assassin requires Merlin to be in play.');
  if (settings.percival && !settings.merlin) errors.push('Percival requires Merlin to be in play.');
  if (settings.morgana && !settings.percival) errors.push('Morgana requires Percival to be in play.');
  if (settings.mordred && !settings.merlin) errors.push('Mordred requires Merlin to be in play.');
  if (settings.lancelot && !settings.merlin) errors.push('Lancelot requires Merlin to be in play.');
  if (settings.lancelotPair && !settings.merlin) errors.push('The Good & Evil Lancelot pair requires Merlin to be in play.');
  if (settings.guinevere && !settings.lancelotPair) errors.push('Guinevere requires the Good & Evil Lancelot pair to be in play.');
  if (settings.lancelot && settings.lancelotPair) errors.push('Lancelot (solo) and the Lancelot pair cannot both be in play — pick one.');

  const evilSpecial = ['mordred', 'morgana', 'oberon', 'assassin', 'agravain'].filter((k) => settings[k]).length + (settings.lancelotPair ? 1 : 0);
  const goodSpecial =
    (settings.tristanIseult ? 2 : 0) +
    (settings.merlin ? 1 : 0) +
    (settings.percival ? 1 : 0) +
    (settings.arthur ? 1 : 0) +
    (settings.lancelot ? 1 : 0) +
    (settings.lancelotPair ? 1 : 0) +
    (settings.guinevere ? 1 : 0);
  if (evilSpecial > cfg.evil) errors.push(`Too many Evil special roles for ${cfg.evil} Evil slots at ${playerCount} players.`);
  if (goodSpecial > cfg.good) errors.push(`Too many Good special roles for ${cfg.good} Good slots at ${playerCount} players.`);

  return errors;
}
