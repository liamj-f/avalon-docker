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
  AGRAVAIN: {
    id: 'AGRAVAIN',
    name: 'Agravain',
    team: 'evil',
    optional: true,
    description: 'A zealous Minion of Mordred — you must play Fail on every quest you’re sent on. No choice, no bluffing.',
  },
  ARTHUR: {
    id: 'ARTHUR',
    name: 'Arthur',
    team: 'good',
    optional: true,
    description: 'Once two quests have failed, you may publicly reveal yourself as Arthur to rally Good — at the cost of painting a target on your back.',
  },
  LANCELOT: {
    id: 'LANCELOT',
    name: 'Lancelot',
    team: 'good',
    optional: true,
    description: 'Appears to Merlin as Evil, a built-in red herring. Holds a single Reverse card — while on a quest, may play it instead of Success to flip that quest’s outcome. Incompatible with the Good & Evil Lancelot pair.',
  },
  LANCELOT_GOOD: {
    id: 'LANCELOT_GOOD',
    name: 'Lancelot',
    team: 'good',
    optional: true,
    description: 'One of a pair of Lancelots. Appears to Merlin as Evil. At a random, secret point in the game the two Lancelots swap allegiance for the rest of the game.',
  },
  LANCELOT_EVIL: {
    id: 'LANCELOT_EVIL',
    name: 'Lancelot',
    team: 'evil',
    optional: true,
    description: 'One of a pair of Lancelots. At a random, secret point in the game the two Lancelots swap allegiance for the rest of the game.',
  },
  GUINEVERE: {
    id: 'GUINEVERE',
    name: 'Guinevere',
    team: 'good',
    optional: true,
    description: 'Knows the identities of both Lancelots, but never which one is currently Good or Evil. Requires the Good & Evil Lancelot pair.',
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
const TOGGLEABLE_ROLES = [
  'MERLIN', 'PERCIVAL', 'MORGANA', 'MORDRED', 'OBERON', 'ASSASSIN', 'AGRAVAIN', 'ARTHUR', 'TRISTAN',
];

function defaultSettings() {
  return {
    merlin: true,
    percival: true,
    morgana: true,
    mordred: false,
    oberon: false,
    assassin: true,
    agravain: false,
    arthur: false,
    tristanIseult: false,
    lancelot: false,
    lancelotPair: false,
    guinevere: false,
    // Extensions — game-flow modifiers rather than characters, so they
    // don't consume a good/evil slot the way the roles above do.
    ladyOfLake: false,
    excalibur: false,
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
  if (settings.lancelot && !settings.merlin) errors.push('Lancelot requires Merlin to be in play (otherwise there is nothing to fool).');
  if (settings.lancelotPair && !settings.merlin) errors.push('The Good & Evil Lancelot pair requires Merlin to be in play (otherwise there is nothing to fool).');
  if (settings.guinevere && !settings.lancelotPair) errors.push('Guinevere requires the Good & Evil Lancelot pair to be in play.');
  if (settings.lancelot && settings.lancelotPair) {
    errors.push('Lancelot (solo) and the Good & Evil Lancelot pair cannot both be in play — pick one.');
  }

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
  if (settings.agravain) evilSpecial.push('AGRAVAIN');
  if (settings.lancelotPair) evilSpecial.push('LANCELOT_EVIL');

  const goodSpecial = [];
  if (settings.tristanIseult) goodSpecial.push('TRISTAN', 'ISEULT');
  if (settings.merlin) goodSpecial.push('MERLIN');
  if (settings.percival) goodSpecial.push('PERCIVAL');
  if (settings.arthur) goodSpecial.push('ARTHUR');
  if (settings.lancelot) goodSpecial.push('LANCELOT');
  if (settings.lancelotPair) goodSpecial.push('LANCELOT_GOOD');
  if (settings.guinevere) goodSpecial.push('GUINEVERE');

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
  const guinevere = assignments.find((a) => a.roleId === 'GUINEVERE');
  const lancelotGood = assignments.find((a) => a.roleId === 'LANCELOT_GOOD');
  const lancelotEvil = assignments.find((a) => a.roleId === 'LANCELOT_EVIL');
  const evilNonOberon = assignments.filter((a) => a.team === 'evil' && a.roleId !== 'OBERON');

  if (merlin) {
    // Evil (minus Mordred) is Merlin's usual sight, but any Lancelot — solo
    // or from the swapping pair — is a built-in red herring: Merlin sees
    // them as Evil regardless of their true, current team.
    const seenAsEvil = new Set(
      assignments.filter((a) => a.team === 'evil' && a.roleId !== 'MORDRED').map((a) => a.seat)
    );
    assignments
      .filter((a) => a.roleId === 'LANCELOT' || a.roleId === 'LANCELOT_GOOD')
      .forEach((a) => seenAsEvil.add(a.seat));
    knowledge.set(
      merlin.seat,
      assignments.filter((a) => seenAsEvil.has(a.seat)).map((a) => ({ seat: a.seat, label: 'Evil' }))
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

  if (guinevere && lancelotGood && lancelotEvil) {
    knowledge.set(guinevere.seat, [
      { seat: lancelotGood.seat, label: 'A Lancelot (allegiance hidden)' },
      { seat: lancelotEvil.seat, label: 'A Lancelot (allegiance hidden)' },
    ]);
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
