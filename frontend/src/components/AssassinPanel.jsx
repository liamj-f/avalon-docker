import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function AssassinPanel({ room, onAssassinate }) {
  const { game, players, you } = room;
  const [targets, setTargets] = useState([]);
  const isAssassin = you.roleId === 'ASSASSIN';
  const hasPairRoute = game.hasTristanIseult;

  // Three modes, matching sp_submit_assassination exactly: name 1 seat
  // (guess Merlin -- Gawain also wins it for Evil, but only in *this*
  // mode), name exactly 2 (guess the Lovers, correct only if it's really
  // Tristan & Iseult), or name nobody (Pass -- Good's win stands, nothing
  // revealed). Toggling a third seat on replaces the oldest pick rather
  // than growing past 2, so there's no dead-end state.
  const toggleTarget = (seat) => {
    setTargets((prev) => {
      if (prev.includes(seat)) return prev.filter((s) => s !== seat);
      const max = hasPairRoute ? 2 : 1;
      if (prev.length >= max) return [...prev.slice(1), seat];
      return [...prev, seat];
    });
  };

  const buttonLabel = targets.length === 2 ? 'Name Tristan & Iseult' : 'Name as your guess';

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Good has won 3 quests — but the Assassin gets one shot</h2>
      <p className="phase-lead">
        {isAssassin
          ? `Choose who you believe is Merlin${game.hasGawain ? ' (Gawain also wins it for Evil)' : ''}.${
              hasPairRoute
                ? ' Or select both Tristan and Iseult if you’ve worked out the secret pair.'
                : ''
            } Or pass, if you’d rather not guess.`
          : 'The Assassin is choosing whether — and who — to name. Hold your breath.'}
      </p>

      <div className="avatar-grid">
        {players
          .filter((p) => p.seat !== you.seat || !isAssassin)
          .map((p) => (
            <PlayerAvatar
              key={p.seat}
              player={p}
              isYou={p.seat === you.seat}
              isSelected={targets.includes(p.seat)}
              selectable={isAssassin}
              onClick={() => toggleTarget(p.seat)}
            />
          ))}
      </div>

      {isAssassin && (
        <div className="vote-buttons">
          <button
            type="button"
            className="btn btn-primary"
            disabled={targets.length === 0}
            onClick={() => onAssassinate(targets)}
          >
            {buttonLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onAssassinate([])}>
            🏳️ Pass — let Good’s win stand
          </button>
        </div>
      )}
    </div>
  );
}
