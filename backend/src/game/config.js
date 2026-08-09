/**
 * Standard Avalon mission tables by player count.
 * teamSizes / failsRequired are indexed by mission number (0-4).
 * good/evil are the total number of players on each side.
 */
const MISSION_CONFIG = {
  5: { teamSizes: [2, 3, 2, 3, 3], failsRequired: [1, 1, 1, 1, 1], good: 3, evil: 2 },
  6: { teamSizes: [2, 3, 4, 3, 4], failsRequired: [1, 1, 1, 1, 1], good: 4, evil: 2 },
  7: { teamSizes: [2, 3, 3, 4, 4], failsRequired: [1, 1, 1, 2, 1], good: 4, evil: 3 },
  8: { teamSizes: [3, 4, 4, 5, 5], failsRequired: [1, 1, 1, 2, 1], good: 5, evil: 3 },
  9: { teamSizes: [3, 4, 4, 5, 5], failsRequired: [1, 1, 1, 2, 1], good: 6, evil: 3 },
  10: { teamSizes: [3, 4, 4, 5, 5], failsRequired: [1, 1, 1, 2, 1], good: 6, evil: 4 },
};

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

module.exports = { MISSION_CONFIG, MIN_PLAYERS, MAX_PLAYERS };
