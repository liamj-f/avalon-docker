import { describe, expect, it } from 'vitest';
import { validateSettingsClient, togglingWouldExceedSlots } from './gameData.js';

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
