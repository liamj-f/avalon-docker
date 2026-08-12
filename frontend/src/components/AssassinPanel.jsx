import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function AssassinPanel({ room, onAssassinate }) {
  const { game, players, you } = room;
  const [targets, setTargets] = useState([]);
  const isAssassin = you.roleId === 'ASSASSIN';
  const hasPairRoute = game.hasTristanIseult;

  // A guess is either 1 seat (a Merlin/Gawain guess) or, when Tristan &
  // Iseult are in play, exactly 2 (a guess at the secret pair) -- see
  // sp_submit_assassination. Toggling a third seat on replaces the oldest
  // pick rather than growing past 2, so there's no dead-end state.
  const toggleTarget = (seat) => {
    setTargets((prev) => {
      if (prev.includes(seat)) return prev.filter((s) => s !== seat);
      const max = hasPairRoute ? 2 : 1;
      if (prev.length >= max) return [...prev.slice(1), seat];
      return [...prev, seat];
    });
  };

  const buttonLabel =
    targets.length === 2 ? 'Name Tristan & Iseult' : targets.length === 1 ? 'Name as your guess' : 'Choose a target';

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Good has won 3 quests — but the Assassin gets one shot</h2>
      <p className="phase-lead">
        {isAssassin
          ? `Choose who you believe is Merlin${game.hasGawain ? ' (Gawain also wins it for Evil)' : ''}.${
              hasPairRoute
                ? ' Or select both Tristan and Iseult if you’ve worked out the secret pair.'
                : ''
            }`
          : 'The Assassin is choosing a target. Hold your breath.'}
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
        <button
          type="button"
          className="btn btn-primary"
          disabled={targets.length === 0}
          onClick={() => onAssassinate(targets)}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
