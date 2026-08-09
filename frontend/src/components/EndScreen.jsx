import React from 'react';
import { useGame } from '../store.jsx';

const REASON_TEXT = {
  missions: 'by winning three missions',
  vote_track: 'because five team proposals were rejected in a row',
  assassination: 'the Assassin correctly identified Merlin',
};

export default function EndScreen({ room }) {
  const { game, players, you } = room;
  const { resetToLobby } = useGame();
  const winnerLabel = game.winner === 'good' ? 'Good' : 'Evil';
  const reasonText = REASON_TEXT[game.winReason] || '';

  return (
    <div className="phase-panel end-screen">
      <h2 className={`end-title end-title-${game.winner}`}>{winnerLabel} wins!</h2>
      <p className="phase-lead">
        {game.winReason === 'assassination'
          ? `The Assassin ${game.winner === 'evil' ? 'correctly named' : 'failed to name'} Merlin.`
          : `Victory ${reasonText}.`}
      </p>

      <h3 className="section-title">Full reveal</h3>
      <ul className="reveal-list">
        {game.reveal.map((r) => {
          const player = players.find((p) => p.seat === r.seat);
          const isAssassinTarget = game.assassinationTarget === r.seat;
          return (
            <li key={r.seat} className={`reveal-row reveal-${r.team}`}>
              <span className="reveal-name">
                {player?.displayName}
                {r.seat === you.seat && <span className="badge badge-you">You</span>}
              </span>
              <span className="reveal-role">{r.role}</span>
              {isAssassinTarget && <span className="badge badge-warn">Assassinated</span>}
            </li>
          );
        })}
      </ul>

      {you.isHost ? (
        <button type="button" className="btn btn-primary" onClick={resetToLobby}>
          Back to Lobby
        </button>
      ) : (
        <p className="hint">Waiting for the host to return everyone to the lobby…</p>
      )}
    </div>
  );
}
