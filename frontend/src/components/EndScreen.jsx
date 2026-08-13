import React from 'react';
import { useGame } from '../store.jsx';

const REASON_TEXT = {
  missions: 'by winning three quests',
  vote_track: 'because five team proposals were rejected in a row',
};

const WINNER_LABEL = { good: 'Good', evil: 'Evil', gawain: 'Gawain' };

export default function EndScreen({ room }) {
  const { game, players, you } = room;
  const { resetToLobby } = useGame();
  const winnerLabel = WINNER_LABEL[game.winner] || 'Evil';
  const reasonText = REASON_TEXT[game.winReason] || '';

  const targetSeats = game.assassinationTargets || [];
  const targetNames = targetSeats.map((s) => players.find((p) => p.seat === s)?.displayName).join(' & ');
  const guessedThePair = targetSeats.length === 2;
  const passed = game.winReason === 'assassination' && targetSeats.length === 0;

  // Naming Merlin correctly wins it for Evil; naming Gawain wins it for
  // Gawain alone -- a third faction, not "Evil, sort of" -- so the two
  // need their own lines even though both start from the same 1-target
  // guess. Anything else in that mode, or a wrong Lovers guess, is Good
  // holding the win it already earned on the field.
  let assassinationLine;
  if (passed) {
    assassinationLine = 'The Assassin passed — Good’s win stands.';
  } else if (game.winner === 'gawain') {
    assassinationLine = `The Assassin named ${targetNames} as Merlin — but that was Gawain! Gawain wins for himself.`;
  } else {
    assassinationLine = `The Assassin named ${targetNames}${guessedThePair ? ' as Tristan & Iseult' : ''} — ${
      game.winner === 'evil' ? 'correct!' : 'incorrect.'
    }`;
  }

  return (
    <div className="phase-panel end-screen">
      <h2 className={`end-title end-title-${game.winner}`}>{winnerLabel} wins!</h2>
      <p className="phase-lead">
        {game.winReason === 'assassination' ? assassinationLine : `Victory ${reasonText}.`}
      </p>

      <h3 className="section-title">Full reveal</h3>
      <ul className="reveal-list">
        {game.reveal.map((r) => {
          const player = players.find((p) => p.seat === r.seat);
          const isAssassinTarget = targetSeats.includes(r.seat);
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
