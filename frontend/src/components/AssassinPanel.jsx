import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function AssassinPanel({ room, onAssassinate }) {
  const { players, you } = room;
  const [target, setTarget] = useState(null);
  const isAssassin = you.roleId === 'ASSASSIN';

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Good has won 3 missions — but the Assassin gets one shot</h2>
      <p className="phase-lead">
        {isAssassin
          ? 'Choose who you believe is Merlin. Guess correctly and Evil steals the win.'
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
              isSelected={target === p.seat}
              selectable={isAssassin}
              onClick={() => setTarget(p.seat)}
            />
          ))}
      </div>

      {isAssassin && (
        <button type="button" className="btn btn-primary" disabled={target === null} onClick={() => onAssassinate(target)}>
          Name Merlin
        </button>
      )}
    </div>
  );
}
