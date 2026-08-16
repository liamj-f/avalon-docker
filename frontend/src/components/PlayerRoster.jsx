import React from 'react';
import { PlayerShield } from './PlayerAvatar.jsx';

// A persistent, always-visible roster for the game screen -- the
// phase-specific avatar-grids (TeamBuilder, VotePanel, MissionPanel, ...)
// come and go with whatever's currently happening and double as click
// targets for game actions, so they're not a safe place to also hang a
// standing "who's connected" view or moderation controls. This is that
// view, reusing the same shield + connection-dot presentation the lobby
// already uses for the same seats.
//
// No Kick here, deliberately -- kick_player only works in the lobby (a
// seat can't be un-dealt from a game already in progress without
// unraveling it), so the host's mid-game moderation tool is muting chat
// instead.
export default function PlayerRoster({ room, onSetMuted }) {
  const { players, you } = room;

  const toggleMuted = (p) => {
    onSetMuted(p.seat, !p.muted);
  };

  return (
    <div className="card">
      <h3 className="section-title">Players</h3>
      <ul className="player-list">
        {players.map((p) => (
          <li key={p.seat} className={`player-row ${p.connected ? '' : 'player-disconnected'}`}>
            <span className="player-shield" aria-hidden="true">
              <PlayerShield seat={p.seat} size={24} dim={!p.connected} />
            </span>
            <span className="player-dot" data-connected={p.connected} />
            <span className="player-name">{p.displayName}</span>
            {p.isHost && <span className="badge">Host</span>}
            {p.seat === you?.seat && <span className="badge badge-you">You</span>}
            {!p.connected && <span className="badge badge-warn">offline</span>}
            {p.muted && <span className="badge badge-warn">muted</span>}
            {you?.isHost && p.seat !== you.seat && (
              <button
                type="button"
                className={`btn btn-ghost btn-tiny ${p.muted ? '' : 'btn-danger-tiny'}`}
                onClick={() => toggleMuted(p)}
                title={p.muted ? 'Allow them to send chat messages again' : "Stop their messages from reaching the table"}
              >
                {p.muted ? 'Unmute' : 'Mute'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
