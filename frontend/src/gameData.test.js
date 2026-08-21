import { describe, expect, it } from 'vitest';
import { validateSettingsClient, togglingWouldExceedSlots, unmetDependency, fullRoster } from './gameData.js';

// validateSettingsClient mirrors backend/src/game/roles.py's real
// validation purely so the lobby can warn a host before they hit "Start" --
// the server re-validates everything regardless, so these tests are about
// keeping this client-side mirror honest, not about game-rule authority.

describe('validateSettingsClient', () => {
  it('rejects player counts outside 5-10', () => {
    expect(validateSettingsClient(4, {})).toEqual(['Need 5–10 players to start (have 4).']);
    expect(validateSettingsClient(11, {})).toEqual(['Need 5–10 players to start (have 11).']);
  });

  it('accepts a valid minimal config with no errors', () => {
    expect(validateSettingsClient(5, {})).toEqual([]);
  });

  it('requires Merlin, Gawain, or Tristan & Iseult for the Assassin to have a target', () => {
    const errors = validateSettingsClient(5, { assassin: true });
    expect(errors).toContain(
      'The Assassin needs at least one valid target in play: Merlin, Gawain, or the Tristan & Iseult pair.',
    );
  });

  it('allows the Assassin once Merlin is in play', () => {
    expect(validateSettingsClient(5, { assassin: true, merlin: true })).toEqual([]);
  });

  it('requires Percival for Morgana', () => {
    const errors = validateSettingsClient(5, { merlin: true, morgana: true });
    expect(errors).toContain('Morgana requires Percival to be in play.');
  });

  it('requires Merlin for Percival', () => {
    const errors = validateSettingsClient(5, { percival: true });
    expect(errors).toContain('Percival requires Merlin to be in play.');
  });

  it('requires the Lancelot pair for Guinevere', () => {
    const errors = validateSettingsClient(5, { merlin: true, guinevere: true });
    expect(errors).toContain('Guinevere requires the Good & Evil Lancelot pair to be in play.');
  });

  it('rejects solo Lancelot and the Lancelot pair together', () => {
    const errors = validateSettingsClient(5, { merlin: true, lancelot: true, lancelotPair: true });
    expect(errors).toContain('Lancelot (solo) and the Lancelot pair cannot both be in play — pick one.');
  });

  it('rejects too many Evil special roles for the player count', () => {
    // 5 players only has 2 Evil slots.
    const errors = validateSettingsClient(5, {
      merlin: true,
      mordred: true,
      morgana: true,
      percival: true,
      oberon: true,
    });
    expect(errors).toContain('Too many Evil special roles for 2 Evil slots at 5 players.');
  });

  it('rejects too many Good special roles for the player count', () => {
    // 5 players only has 3 Good slots.
    const errors = validateSettingsClient(5, { merlin: true, percival: true, gawain: true, arthur: true });
    expect(errors).toContain('Too many Good special roles for 3 Good slots at 5 players.');
  });

  it('accepts a full valid 10-player config', () => {
    const errors = validateSettingsClient(10, {
      merlin: true,
      percival: true,
      morgana: true,
      mordred: true,
      oberon: true,
      assassin: true,
    });
    expect(errors).toEqual([]);
  });
});

// The lobby's per-toggle proactive cap: same slot math as
// validateSettingsClient (in fact shares its implementation via
// specialSlotCounts), applied one hypothetical toggle at a time instead of
// after the fact to a whole settings object.
describe('togglingWouldExceedSlots', () => {
  it('blocks turning on an Evil special once the Evil slots are full', () => {
    // 5 players -> 2 Evil slots, already claimed by Mordred + Morgana.
    const settings = { merlin: true, mordred: true, morgana: true, percival: true };
    expect(togglingWouldExceedSlots(5, settings, 'assassin')).toBe(true);
  });

  it('allows turning on an Evil special while a slot is still free', () => {
    const settings = { merlin: true, mordred: true };
    expect(togglingWouldExceedSlots(5, settings, 'assassin')).toBe(false);
  });

  it('never blocks turning an already-enabled toggle back off', () => {
    // Already claims both Evil slots itself -- but it's already on, so
    // this must be false regardless (toggling it off only frees a slot).
    const settings = { merlin: true, mordred: true, morgana: true };
    expect(togglingWouldExceedSlots(5, settings, 'mordred')).toBe(false);
  });

  it('weighs Tristan & Iseult as 2 real seats, not 1', () => {
    // 5 players -> 3 Good slots. Merlin + Percival already claims 2 of
    // them, leaving only 1 free -- not enough for a 2-seat pair.
    const oneFree = { merlin: true, percival: true };
    expect(togglingWouldExceedSlots(5, oneFree, 'tristanIseult')).toBe(true);
    // With only Merlin claimed, 2 slots are free -- exactly enough.
    const twoFree = { merlin: true };
    expect(togglingWouldExceedSlots(5, twoFree, 'tristanIseult')).toBe(false);
  });

  it('blocks the Lancelot pair if either team is out of room, since it needs one of each', () => {
    // 5 players -> 3 Good / 2 Evil slots. Good is full (3), Evil has room.
    const goodFull = { merlin: true, percival: true, gawain: true };
    expect(togglingWouldExceedSlots(5, goodFull, 'lancelotPair')).toBe(true);

    // Evil is full (2), Good has room.
    const evilFull = { merlin: true, mordred: true, morgana: true, percival: true };
    expect(togglingWouldExceedSlots(5, evilFull, 'lancelotPair')).toBe(true);

    // Both teams have room for one more each.
    const roomForBoth = { merlin: true, mordred: true };
    expect(togglingWouldExceedSlots(5, roomForBoth, 'lancelotPair')).toBe(false);
  });

  it('never blocks anything for an unsupported player count', () => {
    expect(togglingWouldExceedSlots(4, {}, 'merlin')).toBe(false);
  });
});

// The lobby's per-toggle dependency gate: a character that requires
// another one to already be in play is disabled, not just flagged after
// the fact, until that dependency is satisfied.
describe('unmetDependency', () => {
  it('returns null for a role with no dependency', () => {
    expect(unmetDependency({}, 'merlin')).toBeNull();
    expect(unmetDependency({}, 'oberon')).toBeNull();
  });

  it('flags Percival as missing Merlin until Merlin is on', () => {
    expect(unmetDependency({}, 'percival')).toBe('Merlin');
    expect(unmetDependency({ merlin: true }, 'percival')).toBeNull();
  });

  it('flags Morgana as missing Percival specifically, not Merlin', () => {
    expect(unmetDependency({ merlin: true }, 'morgana')).toBe('Percival');
    expect(unmetDependency({ merlin: true, percival: true }, 'morgana')).toBeNull();
  });

  it('flags Mordred, Lancelot, and the Lancelot pair as each missing Merlin', () => {
    expect(unmetDependency({}, 'mordred')).toBe('Merlin');
    expect(unmetDependency({}, 'lancelot')).toBe('Merlin');
    expect(unmetDependency({}, 'lancelotPair')).toBe('Merlin');
  });

  it('flags Guinevere as missing the Lancelot pair, even with solo Lancelot on', () => {
    expect(unmetDependency({ merlin: true, lancelot: true }, 'guinevere')).toBe('the Good & Evil Lancelot pair');
    expect(unmetDependency({ merlin: true, lancelotPair: true }, 'guinevere')).toBeNull();
  });

  it('clears the Assassin once any one of its three valid targets is on', () => {
    const label = 'Merlin, Gawain, or the Tristan & Iseult pair';
    expect(unmetDependency({}, 'assassin')).toBe(label);
    expect(unmetDependency({ merlin: true }, 'assassin')).toBeNull();
    expect(unmetDependency({ gawain: true }, 'assassin')).toBeNull();
    expect(unmetDependency({ tristanIseult: true }, 'assassin')).toBeNull();
  });
});

// The in-game footer's full player-by-player headcount, not just the
// named specials: fullRoster fills in Loyal Servants / Minions for
// whatever's left over, and reports the player count's fixed Good/Evil
// split alongside them.
describe('fullRoster', () => {
  it('returns null for an unsupported player count', () => {
    expect(fullRoster(4, {})).toBeNull();
  });

  it('fills every slot with plain roles when nothing special is toggled', () => {
    const roster = fullRoster(5, {});
    expect(roster.good).toBe(3);
    expect(roster.evil).toBe(2);
    expect(roster.items).toEqual([
      expect.objectContaining({ key: 'loyalServant', count: 3 }),
      expect.objectContaining({ key: 'minion', count: 2 }),
    ]);
  });

  it('lists named specials ahead of the fillers that cover what is left', () => {
    const roster = fullRoster(5, { merlin: true, assassin: true });
    expect(roster.items.map((r) => [r.key, r.count])).toEqual([
      ['merlin', 1],
      ['assassin', 1],
      ['loyalServant', 2],
      ['minion', 1],
    ]);
  });

  it('weighs Tristan & Iseult and the Lancelot pair as 2 seats each, and omits an empty filler', () => {
    // 5 players -> 3 Good slots, all claimed by the pair (2) + Merlin (1) --
    // no Loyal Servant left to fill.
    const roster = fullRoster(5, { merlin: true, tristanIseult: true });
    expect(roster.items.find((r) => r.key === 'tristanIseult')).toMatchObject({ count: 2 });
    expect(roster.items.some((r) => r.key === 'loyalServant')).toBe(false);
  });
});
