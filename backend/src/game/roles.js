const { MISSION_CONFIG } = require('./config');

class GameError extends Error {}

/**
 * Every character this build supports. `optional` roles are toggled by the
 * host in the lobby; the two base roles (LOYAL_SERVANT / MINION) silently
 * fill whatever slots are left over.
 *
 * NOTE on Tristan & Iseult: this is the classic "Lovers" variant where both
 * are Loyal Servants of Arthur who are told each other's identity at the
 * start of the game (but not their own or each other's alignment beyond
 * "good", since here they are always good). It's one of a few documented
 * fan variants of this pair — see README for the design note and how you'd
 * swap in a different interpretation.
 */
const ROLES = {
  MERLIN: {
    id: 'MERLIN',
    name: 'Merlin',
    team: 'good',
    optional: true,
    description: 'Knows the identities of all Evil players (except Mordred, if he is in play). Stay subtle — the Assassin wins the game by identifying you at the end.',
  },
  PERCIVAL: {
    id: 'PERCIVAL',
    name: 'Percival',
    team: 'good',
    optional: true,
    description: 'Knows who Merlin is. If Morgana is in play, Percival instead sees two candidates and must work out which is which.',
  },
  TRISTAN: {
    id: 'TRISTAN',
    name: 'Tristan',
    team: 'good',
    optional: true,
    description: 'A Loyal Servant of Arthur who knows the identity of Iseult, their beloved.',
  },
  ISEULT: {
    id: 'ISEULT',
    name: 'Iseult',
    team: 'good',
    optional: false, // always paired with Tristan, never toggled independently
    description: 'A Loyal Servant of Arthur who knows the identity of Tristan, their beloved.',
  },
  LOYAL_SERVANT: {
    id: 'LOYAL_SERVANT',
    name: 'Loyal Servant of Arthur',
    team: 'good',
    optional: false,
    description: 'A plain member of Arthur’s court. No special knowledge — vote wisely and watch the table.',
  },
  MORGANA: {
    id: 'MORGANA',
    name: 'Morgana',
    team: 'evil',
    optional: true,
    description: 'Appears to Percival as a possible Merlin, muddying the water.',
  },
  MORDRED: {
    id: 'MORDRED',
    name: 'Mordred',
    team: 'evil',
    optional: true,
    description: 'Hidden from Merlin — Merlin does not see you as Evil.',
  },
  OBERON: {
    id: 'OBERON',
    name: 'Oberon',
    team: 'evil',
    optional: true,
    description: 'Does not know the other Evil players, and they do not know you. You are on your own.',
  },
  ASSASSIN: {
    id: 'ASSASSIN',
    name: 'Assassin',
    team: 'evil',
    optional: true,
    description: 'If Good wins three missions, you get one shot at identifying Merlin. Guess correctly and Evil steals the win.',
  },
  MINION: {
    id: 'MINION',
    name: 'Minion of Mordred',
    team: 'evil',
    optional: false,
    description: 'A plain servant of Evil. Knows its fellow Minions (except Oberon) — sabotage missions without getting caught.',
  },
};

/** Roles the lobby UI can toggle on/off. Order matters for display. */
const TOGGLEABLE_ROLES = ['MERLIN', 'PERCIVAL', 'MORGANA', 'MORDRED', 'OBERON', 'ASSASSIN', 'TRISTAN'];

function defaultSettings() {
  return {
    merlin: true,
    percival: true,
    morgana: true,
    mordred: false,
    oberon: false,
    assassin: true,
    tristanIseult: false,
  };
}

/** Cross-role dependency + capacity checks. Returns an array of human-readable errors (empty = valid). */
function validateSettings(playerCount, settings) {
  const errors = [];
  const cfg = MISSION_CONFIG[playerCount];
  if (!cfg) {
    errors.push(`Player count must be between 5 and 10 (got ${playerCount}).`);
    return errors;
  }

  if (settings.assassin && !settings.merlin) errors.push('The Assassin requires Merlin to be in play.');
  if (settings.percival && !settings.merlin) errors.push('Percival requires Merlin to be in play.');
  if (settings.morgana && !settings.percival) errors.push('Morgana requires Percival to be in play (otherwise she has nothing to fool).');
  if (settings.mordred && !settings.merlin) errors.push('Mordred requires Merlin to be in play (otherwise there is nothing to hide from).');

  try {
    buildRoleList(playerCount, settings);
  } catch (err) {
    if (err instanceof GameError) errors.push(err.message);
    else throw err;
  }

  return errors;
}

/** Builds the flat list of role ids to shuffle and deal for a game. Throws GameError if it doesn't fit. */
function buildRoleList(playerCount, settings) {
  const cfg = MISSION_CONFIG[playerCount];
  if (!cfg) throw new GameError(`Unsupported player count: ${playerCount}`);

  const evilSpecial = [];
  if (settings.mordred) evilSpecial.push('MORDRED');
  if (settings.morgana) evilSpecial.push('MORGANA');
  if (settings.oberon) evilSpecial.push('OBERON');
  if (settings.assassin) evilSpecial.push('ASSASSIN');

  const goodSpecial = [];
  if (settings.tristanIseult) goodSpecial.push('TRISTAN', 'ISEULT');
  if (settings.merlin) goodSpecial.push('MERLIN');
  if (settings.percival) goodSpecial.push('PERCIVAL');

  if (evilSpecial.length > cfg.evil) {
    throw new GameError(
      `Too many Evil special roles selected (${evilSpecial.length}) for only ${cfg.evil} Evil slots at ${playerCount} players.`
    );
  }
  if (goodSpecial.length > cfg.good) {
    throw new GameError(
      `Too many Good special roles selected (${goodSpecial.length}) for only ${cfg.good} Good slots at ${playerCount} players.`
    );
  }

  const evilRoles = [...evilSpecial];
  while (evilRoles.length < cfg.evil) evilRoles.push('MINION');

  const goodRoles = [...goodSpecial];
  while (goodRoles.length < cfg.good) goodRoles.push('LOYAL_SERVANT');

  return [...evilRoles, ...goodRoles];
}

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Deals roles to seats. `seats` is an array of seat numbers (0-indexed). */
function assignRoles(seats, settings) {
  const roleIds = shuffle(buildRoleList(seats.length, settings));
  return seats.map((seat, i) => ({
    seat,
    roleId: roleIds[i],
    team: ROLES[roleIds[i]].team,
  }));
}

/**
 * Computes what each seat is allowed to know at role-reveal time.
 * Returns a Map<seat, Array<{ seat, label }>>.
 */
function computeKnowledge(assignments) {
  const knowledge = new Map();
  assignments.forEach((a) => knowledge.set(a.seat, []));

  const merlin = assignments.find((a) => a.roleId === 'MERLIN');
  const morgana = assignments.find((a) => a.roleId === 'MORGANA');
  const percival = assignments.find((a) => a.roleId === 'PERCIVAL');
  const tristan = assignments.find((a) => a.roleId === 'TRISTAN');
  const iseult = assignments.find((a) => a.roleId === 'ISEULT');
  const evilNonOberon = assignments.filter((a) => a.team === 'evil' && a.roleId !== 'OBERON');

  if (merlin) {
    const seenByMerlin = assignments.filter((a) => a.team === 'evil' && a.roleId !== 'MORDRED');
    knowledge.set(
      merlin.seat,
      seenByMerlin.map((a) => ({ seat: a.seat, label: 'Evil' }))
    );
  }

  evilNonOberon.forEach((a) => {
    const others = evilNonOberon.filter((o) => o.seat !== a.seat);
    knowledge.set(
      a.seat,
      others.map((o) => ({ seat: o.seat, label: ROLES[o.roleId].name }))
    );
  });

  if (percival) {
    const candidates = [merlin, morgana].filter(Boolean);
    if (candidates.length === 1) {
      knowledge.set(percival.seat, [{ seat: candidates[0].seat, label: 'Merlin' }]);
    } else if (candidates.length === 2) {
      knowledge.set(
        percival.seat,
        candidates.map((c) => ({ seat: c.seat, label: 'Merlin or Morgana (unclear which)' }))
      );
    }
  }

  if (tristan && iseult) {
    knowledge.set(tristan.seat, [
      ...knowledge.get(tristan.seat),
      { seat: iseult.seat, label: 'Iseult, your beloved (Good)' },
    ]);
    knowledge.set(iseult.seat, [
      ...knowledge.get(iseult.seat),
      { seat: tristan.seat, label: 'Tristan, your beloved (Good)' },
    ]);
  }

  return knowledge;
}

module.exports = {
  GameError,
  ROLES,
  TOGGLEABLE_ROLES,
  defaultSettings,
  validateSettings,
  buildRoleList,
  assignRoles,
  computeKnowledge,
  shuffle,
};
