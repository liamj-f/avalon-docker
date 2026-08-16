import React, { useState } from 'react';
import { useGame } from '../store.jsx';
import { MISSION_CONFIG } from '../gameData.js';

export default function Home() {
  const { createRoom, joinRoom } = useGame();
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('avalon.name') || '');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('create');
  const [showHowToPlay, setShowHowToPlay] = useState(false);

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

      <button
        type="button"
        className="how-to-play-toggle"
        aria-expanded={showHowToPlay}
        onClick={() => setShowHowToPlay((v) => !v)}
      >
        <span>{showHowToPlay ? '▾' : '▸'}</span> New to Avalon? How to play
      </button>

      {showHowToPlay && (
        <div className="how-to-play">
          <p>
            Avalon is a game of hidden loyalty. Most players are <strong>Loyal Servants of Arthur (Good)</strong>; a
            few are secretly <strong>Minions of Mordred (Evil)</strong>, who know each other from the start. Good
            has no idea who&rsquo;s who — that&rsquo;s the whole game.
          </p>

          <h3>Each of the 5 quests</h3>
          <ol>
            <li>The current leader proposes a team of players for the quest.</li>
            <li>
              Everyone votes to approve or reject that team. Majority approves it; on rejection, the next player
              leads and tries again — five rejections in a row and Evil wins outright, no quest needed.
            </li>
            <li>
              Once approved, everyone <em>on</em> the team secretly plays a Success or Fail card. Good players must
              play Success; Evil players may play either.
            </li>
            <li>
              The quest fails if it gets enough Fail cards — usually just 1, though the 4th quest needs 2 at 7+
              players (see the table below).
            </li>
          </ol>

          <h3>Winning</h3>
          <p>
            Good wins by succeeding 3 quests — <em>unless</em> Evil&rsquo;s Assassin then correctly names which
            player is Merlin, which flips the win to Evil at the last second. Evil wins immediately if 3 quests
            fail, or if 5 team proposals in a row are rejected.
          </p>

          <h3>Team size by quest</h3>
          <div className="how-to-play-table-wrap">
            <table className="how-to-play-table">
              <thead>
                <tr>
                  <th>Players</th>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <th key={n}>Quest {n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(MISSION_CONFIG).map(([playerCount, cfg]) => (
                  <tr key={playerCount}>
                    <td>{playerCount}</td>
                    {cfg.teamSizes.map((size, i) => (
                      <td key={i}>
                        {size}
                        {cfg.failsRequired[i] > 1 && <sup title="Needs 2 Fail cards to fail this quest">†</sup>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">† needs 2 Fail cards to fail, not just 1 — every other quest only needs 1.</p>

          <p className="hint">
            Beyond the base roles, the host can add characters with special powers — Merlin, Percival, Excalibur,
            and more — from the lobby once you&rsquo;re in. Each one explains itself there.
          </p>
        </div>
      )}
    </div>
  );
}
