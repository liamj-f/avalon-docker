import React, { useState, useEffect } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function TeamBuilder({ room, onPropose }) {
  const { game, players, you } = room;
  const teamSize = game.teamSizes[game.missionNumber];
  const isLeader = you.seat === game.leaderSeat;
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    setSelected([]);
  }, [game.missionNumber, game.rejectionCount]);

  const toggleSeat = (seat) => {
    setSelected((prev) => {
      if (prev.includes(seat)) return prev.filter((s) => s !== seat);
      if (prev.length >= teamSize) return prev;
      return [...prev, seat];
    });
  };

  const leaderName = players.find((p) => p.seat === game.leaderSeat)?.displayName;

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Build the team</h2>
      <p className="phase-lead">
        Mission {game.missionNumber + 1} needs <strong>{teamSize}</strong> players.
        {!isLeader && (
          <>
            {' '}
            Waiting on the leader, <strong>{leaderName}</strong>, to propose a team.
          </>
        )}
      </p>

      <div className="avatar-grid">
        {players.map((p) => (
          <PlayerAvatar
            key={p.seat}
            player={p}
            isLeader={p.seat === game.leaderSeat}
            isYou={p.seat === you.seat}
            isSelected={selected.includes(p.seat)}
            selectable={isLeader}
            onClick={() => toggleSeat(p.seat)}
          />
        ))}
      </div>

      {isLeader && (
        <button type="button" className="btn btn-primary" disabled={selected.length !== teamSize} onClick={() => onPropose(selected)}>
          Propose Team ({selected.length}/{teamSize})
        </button>
      )}
    </div>
  );
}
