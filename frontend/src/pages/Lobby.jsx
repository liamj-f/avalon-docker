import React from 'react';
import { useGame } from '../store.jsx';
import { ROLE_TOGGLES, EXTENSION_TOGGLES, validateSettingsClient } from '../gameData.js';

export default function Lobby() {
  const { state, updateSettings, startGame, leaveRoom, setRolePreference, transferHost } = useGame();
  const { room } = state;
  const { you, players, settings, minPlayers, maxPlayers, rolePreferenceTally } = room;

  const errors = validateSettingsClient(players.length, settings);
  const notEnoughPlayers = players.length < minPlayers;
  const canStart = you?.isHost && errors.length === 0 && !notEnoughPlayers;

  const copyCode = () => {
    navigator.clipboard?.writeText(room.code).catch(() => {});
  };

  const toggleSetting = (key) => {
    if (!you?.isHost) return;
    updateSettings({ [key]: !settings[key] });
  };

  const toggleVote = (key) => {
    const current = rolePreferenceTally[key];
    setRolePreference(key, !current?.you);
  };

  const renderToggleGroup = (items) =>
    items.map((r) => {
      const tally = rolePreferenceTally[r.key] || { count: 0, you: false };
      return (
        <div key={r.key} className={`role-toggle role-toggle-${r.team || 'neutral'} ${settings[r.key] ? 'active' : ''}`}>
          <button type="button" className="role-toggle-main" onClick={() => toggleSetting(r.key)} disabled={!you?.isHost}>
            <div className="role-toggle-head">
              <span>{r.name}</span>
              {r.team && <span className={`team-chip team-chip-${r.team}`}>{r.team}</span>}
            </div>
            <p>{r.description}</p>
          </button>
          <button
            type="button"
            className={`vote-pill ${tally.you ? 'vote-pill-active' : ''}`}
            onClick={() => toggleVote(r.key)}
            title="Cast your non-binding preference vote — the host still decides"
          >
            👍 {tally.count}
          </button>
        </div>
      );
    });

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
              {you?.isHost && p.seat !== you.seat && p.connected && (
                <button type="button" className="btn btn-ghost btn-tiny" onClick={() => transferHost(p.seat)}>
                  Make host
                </button>
              )}
            </li>
          ))}
        </ul>
        {notEnoughPlayers && (
          <p className="hint">Need at least {minPlayers} players to start ({players.length} so far).</p>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Roles</h2>
        <p className="hint">
          {you?.isHost ? 'Toggle which characters are in play.' : 'Only the host can change roles.'} Everyone can cast a
          👍 preference vote — it&rsquo;s advisory, the host has final say.
        </p>
        <div className="role-toggle-grid">{renderToggleGroup(ROLE_TOGGLES)}</div>

        <h2 className="section-title" style={{ marginTop: 20 }}>
          Extensions
        </h2>
        <div className="role-toggle-grid">{renderToggleGroup(EXTENSION_TOGGLES)}</div>

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
      </div>
    </div>
  );
}
