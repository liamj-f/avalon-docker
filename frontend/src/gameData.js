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

  const evilSpecial = ['mordred', 'morgana', 'oberon', 'assassin'].filter((k) => settings[k]).length;
  const goodSpecial = (settings.tristanIseult ? 2 : 0) + (settings.merlin ? 1 : 0) + (settings.percival ? 1 : 0);
  if (evilSpecial > cfg.evil) errors.push(`Too many Evil special roles for ${cfg.evil} Evil slots at ${playerCount} players.`);
  if (goodSpecial > cfg.good) errors.push(`Too many Good special roles for ${cfg.good} Good slots at ${playerCount} players.`);

  return errors;
}
