import React from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function VotePanel({ room, onVote }) {
  const { game, players, you } = room;
  const proposedSet = new Set(game.proposedTeam);
  const leader = players.find((p) => p.seat === game.leaderSeat);
  const excaliburHolder = game.hasExcalibur && !game.excaliburUsed && players.find((p) => p.seat === game.excaliburHolderSeat);

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Vote on {leader?.displayName}&rsquo;s proposed team</h2>

      {excaliburHolder && (
        <p className="hint">
          ⚔️ If this team is approved, <strong>{excaliburHolder.displayName}</strong> will hold Excalibur for this quest.
        </p>
      )}

      <div className="avatar-grid">
        {players.map((p) => (
          <PlayerAvatar key={p.seat} player={p} isLeader={p.seat === game.leaderSeat} isOnTeam={proposedSet.has(p.seat)} isYou={p.seat === you.seat} />
        ))}
      </div>

      {!game.hasVoted ? (
        <div className="vote-buttons">
          <button type="button" className="btn btn-approve" onClick={() => onVote(true)}>
            👍 Approve
          </button>
          <button type="button" className="btn btn-reject" onClick={() => onVote(false)}>
            👎 Reject
          </button>
        </div>
      ) : (
        <p className="hint">
          Vote submitted — waiting on {players.length - game.votesInSoFar} more player{players.length - game.votesInSoFar === 1 ? '' : 's'}…
        </p>
      )}
    </div>
  );
}
