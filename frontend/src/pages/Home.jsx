import React, { useState } from 'react';
import { useGame } from '../store.jsx';

export default function Home() {
  const { createRoom, joinRoom } = useGame();
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('avalon.name') || '');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('create');

  const handleSubmit = (e) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    localStorage.setItem('avalon.name', name);
    if (mode === 'create') {
      createRoom(name);
    } else {
      if (!code.trim()) return;
      joinRoom(code.trim().toUpperCase(), name);
    }
  };

  return (
    <div className="card home-card">
      <h1 className="page-title">Gather your court</h1>
      <p className="page-subtitle">
        Create a lobby or join one with a room code. 5–10 players, real-time voting and quests,
        Postgres-backed game history.
      </p>

      <div className="tab-row">
        <button type="button" className={mode === 'create' ? 'tab active' : 'tab'} onClick={() => setMode('create')}>
          Create Lobby
        </button>
        <button type="button" className={mode === 'join' ? 'tab active' : 'tab'} onClick={() => setMode('join')}>
          Join Lobby
        </button>
      </div>

      <form onSubmit={handleSubmit} className="form-stack">
        <label className="field">
          <span>Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={30}
            placeholder="e.g. Sir Gawain"
            autoFocus
          />
        </label>

        {mode === 'join' && (
          <label className="field">
            <span>Room code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="e.g. K7QRT"
              className="mono"
            />
          </label>
        )}

        <button type="submit" className="btn btn-primary">
          {mode === 'create' ? 'Create Lobby' : 'Join Lobby'}
        </button>
      </form>
    </div>
  );
}
