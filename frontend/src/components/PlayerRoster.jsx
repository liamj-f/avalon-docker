import React from 'react';
import { PlayerShield } from './PlayerAvatar.jsx';

// A persistent, always-visible roster for the game screen -- the
// phase-specific avatar-grids (TeamBuilder, VotePanel, MissionPanel, ...)
// come and go with whatever's currently happening and double as click
// targets for game actions, so they're not a safe place to also hang a
// standing "who's connected" view or a kick button. This is that view,
// reusing the same shield + connection-dot presentation the lobby already
// uses for the same seats.
export default function PlayerRoster({ room, onKick }) {
  const { players, you } = room;

  const kick = (p) => {
    if (window.confirm(`Remove ${p.displayName} from the game?`)) onKick(p.seat);
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
            {you?.isHost && p.seat !== you.seat && (
              <button type="button" className="btn btn-ghost btn-tiny btn-danger-tiny" onClick={() => kick(p)}>
                Kick
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
