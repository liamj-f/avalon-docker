import React from 'react';

/**
 * Every past team vote, in full — who proposed it, who was on the team,
 * and how each seat voted. The one attempt currently being voted on (if
 * any) is never in here; VotePanel covers that live, without leaking
 * anyone's choice before everyone's in (see game_db.py's voteHistory
 * query for why).
 */
export default function VoteHistory({ room }) {
  const { game, players } = room;
  const history = game.voteHistory;
  if (!history || history.length === 0) return null;

  const nameFor = (seat) => players.find((p) => p.seat === seat)?.displayName || `Seat ${seat}`;

  return (
    <div className="card vote-history">
      <h2 className="section-title">Team vote history</h2>
      <ul className="vote-history-list">
        {[...history].reverse().map((entry) => (
          <li
            key={`${entry.missionNumber}-${entry.attempt}`}
            className={`vote-history-card ${entry.approved ? 'vote-history-approved' : 'vote-history-rejected'}`}
          >
            <div className="vote-history-head">
              <span>
                Quest {entry.missionNumber + 1} &middot; Proposal {entry.attempt + 1}
              </span>
              <span className={entry.approved ? 'outcome-approved' : 'outcome-rejected'}>
                {entry.approved ? 'Approved' : 'Rejected'}
              </span>
            </div>
            <p className="vote-history-team">
              <strong>{nameFor(entry.leaderSeat)}</strong> proposed: {entry.team.map(nameFor).join(', ')}
            </p>
            <div className="vote-history-votes">
              {entry.votes.map((v) => (
                <span key={v.seat} className={`vote-chip ${v.approve ? 'vote-chip-approve' : 'vote-chip-reject'}`}>
                  {v.approve ? '👍' : '👎'} {nameFor(v.seat)}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
