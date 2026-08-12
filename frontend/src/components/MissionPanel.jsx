import React from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function MissionPanel({ room, onPlayCard }) {
  const { game, players, you } = room;
  const onTeam = game.proposedTeam.includes(you.seat);
  const proposedSet = new Set(game.proposedTeam);
  const canReverse = you.roleId === 'LANCELOT' && you.hasReverseCard;

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Quest {game.missionNumber + 1} is underway</h2>

      <div className="avatar-grid">
        {players.map((p) => (
          <PlayerAvatar key={p.seat} player={p} isOnTeam={proposedSet.has(p.seat)} isYou={p.seat === you.seat} />
        ))}
      </div>

      {onTeam ? (
        game.hasPlayedMissionCard ? (
          <p className="hint">Card played — waiting on the rest of the team…</p>
        ) : (
          <>
            <p className="phase-lead">Play your card face-down.</p>
            <div className="vote-buttons">
              <button type="button" className="btn btn-approve" onClick={() => onPlayCard(true)}>
                ✅ Success
              </button>
              {you.team === 'evil' && (
                <button type="button" className="btn btn-reject" onClick={() => onPlayCard(false)}>
                  ❌ Fail
                </button>
              )}
              {canReverse && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onPlayCard(true, true)}
                  title="One-time use: flips this quest's final outcome instead of playing Success or Fail"
                >
                  🔄 Play Reverse (Lancelot)
                </button>
              )}
            </div>
          </>
        )
      ) : (
        <p className="hint">
          You&rsquo;re not on this quest ({game.missionVotesInSoFar}/{game.proposedTeam.length} cards played). Sit tight.
        </p>
      )}
    </div>
  );
}
