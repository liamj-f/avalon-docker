import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function LadyOfLakePanel({ room, onUse }) {
  const { game, players, you } = room;
  const [target, setTarget] = useState(null);
  const isHolder = you.seat === game.ladyHolderSeat;
  const holderName = players.find((p) => p.seat === game.ladyHolderSeat)?.displayName;

  // lady_history isn't sent to the client directly, but anyone already
  // examined this game shows up as a past target in the reveals list —
  // that's only visible to the holder who examined them, so we can't fully
  // grey out ineligible seats for spectators. The holder still gets a
  // server-side check either way.
  return (
    <div className="phase-panel">
      <h2 className="phase-title">🌊 The Lady of the Lake</h2>
      <p className="phase-lead">
        {isHolder
          ? 'Choose a player to secretly check their loyalty. The Lady then passes to them.'
          : `${holderName} holds the Lady of the Lake and is choosing who to examine.`}
      </p>

      <div className="avatar-grid">
        {players.map((p) => (
          <PlayerAvatar
            key={p.seat}
            player={p}
            isYou={p.seat === you.seat}
            isSelected={target === p.seat}
            selectable={isHolder && p.seat !== you.seat}
            onClick={() => setTarget(p.seat)}
          />
        ))}
      </div>

      {isHolder && (
        <button type="button" className="btn btn-primary" disabled={target === null} onClick={() => onUse(target)}>
          Examine
        </button>
      )}

      {you.ladyOfLakeReveals?.length > 0 && (
        <div className="knowledge-box">
          <h3>What you've learned</h3>
          <ul>
            {you.ladyOfLakeReveals.map((r) => {
              const p = players.find((pl) => pl.seat === r.targetSeat);
              return (
                <li key={r.missionNumber}>
                  After mission {r.missionNumber + 1}: <strong>{p?.displayName}</strong> is {r.team}.
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
