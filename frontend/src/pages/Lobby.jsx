import React from 'react';
import { useGame } from '../store.jsx';
import {
  ROLE_TOGGLES,
  EXTENSION_TOGGLES,
  MISSION_CONFIG,
  validateSettingsClient,
  togglingWouldExceedSlots,
  unmetDependency,
  conflictingWith,
} from '../gameData.js';
import { PlayerShield } from '../components/PlayerAvatar.jsx';
import Chat from '../components/Chat.jsx';

export default function Lobby() {
  const { state, updateSettings, startGame, leaveRoom, setRolePreference, transferHost, kickPlayer, setMuted } =
    useGame();
  const { room } = state;
  const { you, players, settings, minPlayers, maxPlayers, rolePreferenceTally, rolesHidden } = room;

  const kick = (p) => {
    if (window.confirm(`Remove ${p.displayName} from the room?`)) kickPlayer(p.seat);
  };

  // Same rule as PlayerRoster.jsx's mid-game mute button -- host-only,
  // can't target yourself (rooms.py's set_muted rejects that server-side
  // regardless, this just avoids showing a button that would always
  // error). Mute state persists across the game starting/ending (it lives
  // on the Player, not reset by reset_to_lobby), so muting someone here
  // carries straight into the game if one starts.
  const toggleMuted = (p) => {
    setMuted(p.seat, !p.muted);
  };

  const errors = validateSettingsClient(players.length, settings);
  const notEnoughPlayers = players.length < minPlayers;
  const canStart = you?.isHost && errors.length === 0 && !notEnoughPlayers;
  // Live "how many Good/Evil at this table" readout -- lets everyone see
  // the split forming as players join/leave, rather than only finding out
  // once the game deals roles. undefined outside 5-10 players (mirrors
  // MISSION_CONFIG's own range; notEnoughPlayers/maxPlayers already cover
  // that case with their own messaging).
  const missionCfg = MISSION_CONFIG[players.length];

  const copyCode = () => {
    navigator.clipboard?.writeText(room.code).catch(() => {});
  };

  const toggleSetting = (key) => {
    if (!you?.isHost) return;
    updateSettings({ [key]: !settings[key] });
  };

  const toggleHideSelections = () => {
    if (!you?.isHost) return;
    updateSettings({ hideRoleSelections: !room.rolesHidden });
  };

  const toggleVote = (key) => {
    const current = rolePreferenceTally[key];
    setRolePreference(key, !current?.you);
  };

  const renderToggleGroup = (items) =>
    items.map((r) => {
      const tally = rolePreferenceTally[r.key] || { count: 0, you: false };
      const active = !!settings[r.key];
      // Proactively block turning this on once there's no room left for it
      // -- Tristan & Iseult and the Lancelot pair each need 2 real seats,
      // not 1, already accounted for inside togglingWouldExceedSlots.
      // Never blocks turning an already-enabled one back off.
      const noSlotsLeft = !active && togglingWouldExceedSlots(players.length, settings, r.key);
      // Same idea for characters that only make sense once another one is
      // already in play (Morgana needs Percival, Assassin needs a target,
      // ...) -- checked ahead of the slot cap so a still-missing dependency
      // is what the host sees first, since it's the more fundamental
      // reason the toggle isn't available yet.
      const missingDependency = !active ? unmetDependency(settings, r.key) : null;
      // And the reverse relationship -- solo Lancelot and the pair can
      // never both be on. Room.update_settings would silently resolve this
      // in the host's favor regardless (whichever they just clicked wins),
      // but greying out the other option makes that visible instead of
      // surprising -- clicking Lancelot while the pair is active would
      // otherwise look like nothing happened.
      const conflict = !active ? conflictingWith(settings, r.key) : null;
      const disabledReason = missingDependency
        ? `Requires ${missingDependency} to be in play first.`
        : conflict
          ? `Cannot be combined with ${conflict}.`
          : noSlotsLeft
            ? `Not enough player slots left at ${players.length} players to add this.`
            : undefined;
      return (
        <div key={r.key} className={`role-toggle role-toggle-${r.team || 'neutral'} ${active ? 'active' : ''}`}>
          <button
            type="button"
            className="role-toggle-main"
            aria-pressed={active}
            onClick={() => toggleSetting(r.key)}
            disabled={!you?.isHost || noSlotsLeft || !!missingDependency || !!conflict}
            title={disabledReason}
          >
            <div className="role-toggle-head">
              <span className="role-toggle-name">{r.name}</span>
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
        {missionCfg && (
          <div className="lobby-team-split">
            <span className="team-chip team-chip-good">{missionCfg.good} Good</span>
            <span className="team-chip team-chip-evil">{missionCfg.evil} Evil</span>
          </div>
        )}
        <ul className="player-list">
          {players.map((p) => (
            <li key={p.seat} className={`player-row ${p.connected ? '' : 'player-disconnected'}`}>
              <span className="player-row-main">
                <span className="player-shield" aria-hidden="true">
                  <PlayerShield seat={p.seat} size={28} dim={!p.connected} />
                </span>
                <span className="player-dot" data-connected={p.connected} />
                <span className="player-name">{p.displayName}</span>
              </span>
              {/* Own line below the name (see .player-row-meta) -- badges
                  alone already squeezed a long name on the host's own row
                  (Host + You together, with no action buttons to have
                  already forced a wrap there), and up to three buttons on
                  top of that on every other row made it worse. */}
              <span className="player-row-meta">
                {p.isHost && <span className="badge">Host</span>}
                {p.seat === you?.seat && <span className="badge badge-you">You</span>}
                {!p.connected && <span className="badge badge-warn">offline</span>}
                {p.muted && <span className="badge badge-warn">muted</span>}
                {you?.isHost && p.seat !== you.seat && (
                  <>
                    {p.connected && (
                      <button type="button" className="btn btn-ghost btn-tiny" onClick={() => transferHost(p.seat)}>
                        Make host
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn btn-ghost btn-tiny ${p.muted ? '' : 'btn-danger-tiny'}`}
                      onClick={() => toggleMuted(p)}
                      title={p.muted ? 'Allow them to send chat messages again' : "Stop their messages from reaching the table"}
                    >
                      {p.muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-tiny btn-danger-tiny" onClick={() => kick(p)}>
                      Kick
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        {notEnoughPlayers && (
          <p className="hint">Need at least {minPlayers} players to start ({players.length} so far).</p>
        )}
      </div>

      <div className="card">
        <div className="section-title-row">
          <h2 className="section-title">Roles</h2>
          {you?.isHost && (
            <button
              type="button"
              className="hide-toggle"
              role="switch"
              aria-checked={!!rolesHidden}
              onClick={toggleHideSelections}
            >
              <span className={`role-toggle-switch ${rolesHidden ? 'role-toggle-switch-on' : ''}`} aria-hidden="true" />
              Hide selections from other players
            </button>
          )}
        </div>
        <p className="hint">
          {you?.isHost ? 'Toggle which characters are in play.' : 'Only the host can change roles.'} Everyone can cast a
          👍 preference vote — it&rsquo;s advisory, the host has final say.
        </p>
        {rolesHidden && !you?.isHost && (
          <p className="hidden-roles-banner">
            🙈 The host has hidden the character selections — you&rsquo;ll see the full roster once the game starts.
          </p>
        )}
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

      <Chat chat={room.chat} muted={you?.muted} className="lobby-chat-box" />
    </div>
  );
}
