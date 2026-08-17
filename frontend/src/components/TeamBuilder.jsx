import React, { useState, useEffect } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';
import StuckPhaseNotice from './StuckPhaseNotice.jsx';

export default function TeamBuilder({ room, onPropose, onForceAdvanceLeader }) {
  const { game, players, you } = room;
  const teamSize = game.teamSizes[game.missionNumber];
  const isLeader = you.seat === game.leaderSeat;
  const [selected, setSelected] = useState([]);
  const [excaliburSeat, setExcaliburSeat] = useState(null);
  const needsExcalibur = game.hasExcalibur && !game.excaliburUsed;

  // Unlike the other stuck-phase notices, this doesn't need to check
  // "has anyone actually acted yet" -- there's no partial state at
  // team-building (either a team's been proposed, moving the phase along
  // entirely, or it hasn't). The only question is whether the one seat
  // that can act right now, the leader, is reachable.
  const leader = players.find((p) => p.seat === game.leaderSeat);
  const leaderStuck = !isLeader && leader && !leader.connected;

  useEffect(() => {
    setSelected([]);
    setExcaliburSeat(null);
  }, [game.missionNumber, game.rejectionCount]);

  // If the leader deselects whoever they'd picked to hold Excalibur, the
  // pick no longer makes sense -- drop it rather than silently propose a
  // stale seat that isn't even on the team anymore.
  useEffect(() => {
    if (excaliburSeat !== null && !selected.includes(excaliburSeat)) {
      setExcaliburSeat(null);
    }
  }, [selected, excaliburSeat]);

  const toggleSeat = (seat) => {
    setSelected((prev) => {
      if (prev.includes(seat)) return prev.filter((s) => s !== seat);
      if (prev.length >= teamSize) return prev;
      return [...prev, seat];
    });
  };

  const leaderName = players.find((p) => p.seat === game.leaderSeat)?.displayName;
  const teamComplete = selected.length === teamSize;
  const excaliburCandidates = selected.filter((s) => s !== you.seat);
  const canPropose = teamComplete && (!needsExcalibur || excaliburSeat !== null);

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Build the team</h2>
      <p className="phase-lead">
        Quest {game.missionNumber + 1} needs <strong>{teamSize}</strong> players.
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

      {isLeader && needsExcalibur && teamComplete && (
        <div className="excalibur-picker">
          <p className="phase-lead">
            ⚔️ Who holds Excalibur for this quest? (Not yourself — everyone will see this before voting.)
          </p>
          <div className="avatar-grid">
            {excaliburCandidates.map((seat) => {
              const p = players.find((pl) => pl.seat === seat);
              return (
                <PlayerAvatar
                  key={seat}
                  player={p}
                  isSelected={excaliburSeat === seat}
                  selectable
                  onClick={() => setExcaliburSeat(seat)}
                />
              );
            })}
          </div>
        </div>
      )}

      {isLeader && (
        <button type="button" className="btn btn-primary" disabled={!canPropose} onClick={() => onPropose(selected, excaliburSeat ?? undefined)}>
          Propose Team ({selected.length}/{teamSize})
          {needsExcalibur ? excaliburSeat === null ? ' — pick Excalibur holder' : '' : ''}
        </button>
      )}

      {you.isHost && leaderStuck && (
        <StuckPhaseNotice
          message={`${leader.displayName} is disconnected and can't propose a team. You can force it through — leadership passes to the next player, same as a real rejected vote would, but without counting against the 5-rejections track.`}
          buttonLabel="Force-advance stuck leader"
          confirmMessage={`Skip ${leader.displayName}'s turn as leader? It'll pass to the next player instead.`}
          onClick={onForceAdvanceLeader}
        />
      )}
    </div>
  );
}
