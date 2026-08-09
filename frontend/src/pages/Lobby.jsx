import React from 'react';
import { useGame } from '../store.jsx';
import { ROLE_TOGGLES, validateSettingsClient } from '../gameData.js';

export default function Lobby() {
  const { state, updateSettings, startGame, leaveRoom } = useGame();
  const { room } = state;
  const { you, players, settings, minPlayers, maxPlayers } = room;

  const errors = validateSettingsClient(players.length, settings);
  const notEnoughPlayers = players.length < minPlayers;
  const canStart = you?.isHost && errors.length === 0 && !notEnoughPlayers;

  const copyCode = () => {
    navigator.clipboard?.writeText(room.code).catch(() => {});
  };

  const toggle = (key) => {
    if (!you?.isHost) return;
    updateSettings({ [key]: !settings[key] });
  };

  return (
    <div className="lobby-grid">
      <div className="card">
        <div className="lobby-code-row">
          <div>
            <div className="page-subtitle" style={{ marginBottom: 4 }}>
              Room code
            </div>
            <div className="room-code" onClick={copyCode} title="Click to copy">
              {room.code}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={leaveRoom}>
            Leave
          </button>
        </div>

        <h2 className="section-title">
          Players ({players.length}/{maxPlayers})
        </h2>
        <ul className="player-list">
          {players.map((p) => (
            <li key={p.seat} className={`player-row ${p.connected ? '' : 'player-disconnected'}`}>
              <span className="player-dot" data-connected={p.connected} />
              <span className="player-name">{p.displayName}</span>
              {p.isHost && <span className="badge">Host</span>}
              {p.seat === you?.seat && <span className="badge badge-you">You</span>}
              {!p.connected && <span className="badge badge-warn">offline</span>}
            </li>
          ))}
        </ul>
        {notEnoughPlayers && (
          <p className="hint">Need at least {minPlayers} players to start ({players.length} so far).</p>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Roles</h2>
        <p className="hint">{you?.isHost ? 'Toggle which characters are in play.' : 'Only the host can change roles.'}</p>
        <div className="role-toggle-grid">
          {ROLE_TOGGLES.map((r) => (
            <button
              type="button"
              key={r.key}
              className={`role-toggle role-toggle-${r.team} ${settings[r.key] ? 'active' : ''}`}
              onClick={() => toggle(r.key)}
              disabled={!you?.isHost}
            >
              <div className="role-toggle-head">
                <span>{r.name}</span>
                <span className={`team-chip team-chip-${r.team}`}>{r.team}</span>
              </div>
              <p>{r.description}</p>
            </button>
          ))}
        </div>

        {errors.length > 0 && (
          <ul className="error-list">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <button type="button" className="btn btn-primary btn-block" disabled={!canStart} onClick={startGame}>
          {you?.isHost ? 'Start Game' : 'Waiting for host…'}
        </button>

        <p className="hint" style={{ marginTop: 12 }}>
          Excalibur is planned as a future add-on (allows Good to inspect or override a mission vote mid-game) — not
          yet implemented.
        </p>
      </div>
    </div>
  );
}
