import React from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function ExcaliburPanel({ room, onDecide }) {
  const { game, players, you } = room;
  const isHolder = you.seat === game.excaliburHolderSeat;
  const holderName = players.find((p) => p.seat === game.excaliburHolderSeat)?.displayName;
  const proposedSet = new Set(game.proposedTeam);

  return (
    <div className="phase-panel">
      <h2 className="phase-title">⚔️ Excalibur</h2>
      <p className="phase-lead">
        {isHolder
          ? `This mission came back with ${you.excaliburPendingFailCount} Fail${you.excaliburPendingFailCount === 1 ? '' : 's'}. You may cleanse one Fail into a Success — using it spends Excalibur for the rest of the game, so choose carefully.`
          : `${holderName} holds Excalibur and is deciding whether to cleanse this mission.`}
      </p>

      <div className="avatar-grid">
        {players.map((p) => (
          <PlayerAvatar key={p.seat} player={p} isOnTeam={proposedSet.has(p.seat)} isYou={p.seat === you.seat} />
        ))}
      </div>

      {isHolder && (
        <div className="vote-buttons">
          <button type="button" className="btn btn-approve" onClick={() => onDecide(true)}>
            ✨ Use Excalibur (cleanse one Fail)
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onDecide(false)}>
            Hold onto it
          </button>
        </div>
      )}
    </div>
  );
}
