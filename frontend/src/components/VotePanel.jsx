import React from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';
import StuckPhaseNotice from './StuckPhaseNotice.jsx';

export default function VotePanel({ room, onVote, onForceResolve }) {
  const { game, players, you } = room;
  const proposedSet = new Set(game.proposedTeam);
  const leader = players.find((p) => p.seat === game.leaderSeat);
  const excaliburHolder = game.hasExcalibur && !game.excaliburUsed && players.find((p) => p.seat === game.excaliburHolderSeat);
  // Same shape as MissionPanel's stuck-quest notice: nobody knows who
  // specifically hasn't voted yet (in-progress choices are secret), so this
  // just checks whether *anyone* is disconnected -- sp_force_resolve_team_vote
  // is a safe no-op speculative call regardless (only fills in seats that
  // are both disconnected and actually still missing a vote).
  const hasDisconnectedPlayer = players.some((p) => !p.connected);

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
          <PlayerAvatar
            key={p.seat}
            player={p}
            isLeader={p.seat === game.leaderSeat}
            isOnTeam={proposedSet.has(p.seat)}
            isExcaliburHolder={!!excaliburHolder && p.seat === excaliburHolder.seat}
            isYou={p.seat === you.seat}
          />
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

      {you.isHost && hasDisconnectedPlayer && (
        <StuckPhaseNotice
          message="Someone at the table is disconnected and may not have voted yet. You can force it through — anyone still missing gets counted as an Approve on their behalf."
          buttonLabel="Force-resolve stuck vote"
          confirmMessage="Force this vote through? Anyone still missing a vote will be counted as Approve."
          onClick={onForceResolve}
        />
      )}
    </div>
  );
}
