import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reducer, TOKEN_KEY } from './store.jsx';

// Focused on SESSION_INVALID specifically: the reset-to-Home behavior for
// a kicked (or otherwise session-no-longer-valid) player. The rest of the
// reducer's cases are simple enough to be covered by the live/component
// tests elsewhere; this one has real logic worth pinning down on its own
// (clears state.room AND state.token, but *keeps* the error message,
// unlike LEFT which has no message to show).

const baseState = {
  connected: true,
  token: 'some-token',
  room: { code: 'ABCDE', phase: 'lobby' },
  error: null,
};

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, 'some-token');
});

afterEach(() => {
  localStorage.clear();
});

describe('reducer', () => {
  it('SESSION_INVALID clears both room and token, and sets the error message', () => {
    const next = reducer(baseState, { type: 'SESSION_INVALID', message: 'You were removed from the room by the host.' });
    expect(next.room).toBeNull();
    expect(next.token).toBeNull();
    expect(next.error).toBe('You were removed from the room by the host.');
  });

  it('SESSION_INVALID removes the persisted token from localStorage, same as LEFT', () => {
    reducer(baseState, { type: 'SESSION_INVALID', message: 'kicked' });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('LEFT clears room and token but leaves error untouched (unlike SESSION_INVALID)', () => {
    const next = reducer(baseState, { type: 'LEFT' });
    expect(next.room).toBeNull();
    expect(next.token).toBeNull();
    expect(next.error).toBe(baseState.error);
  });

  it('does not touch `connected` -- SESSION_INVALID fires independently of the socket\'s own connection state', () => {
    const next = reducer({ ...baseState, connected: true }, { type: 'SESSION_INVALID', message: 'kicked' });
    expect(next.connected).toBe(true);
  });
});
