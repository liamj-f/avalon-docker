import React from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function MissionPanel({ room, onPlayCard, onForceResolve }) {
  const { game, players, you } = room;
  const onTeam = game.proposedTeam.includes(you.seat);
  const proposedSet = new Set(game.proposedTeam);
  const canReverse = you.roleId === 'LANCELOT' && you.hasReverseCard;
  const excaliburHolderSeat = game.hasExcalibur && !game.excaliburUsed ? game.excaliburHolderSeat : null;

  // Only surfaced once there's an actual reason to reach for it -- the
  // quest is still short cards and at least one of the missing seats is
  // offline, not just slow to act.
  const missionIncomplete = game.missionVotesInSoFar < game.proposedTeam.length;
  const hasStuckTeammate =
    missionIncomplete && game.proposedTeam.some((seat) => players.find((p) => p.seat === seat)?.connected === false);

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Quest {game.missionNumber + 1} is underway</h2>

      <div className="avatar-grid">
        {players.map((p) => (
          <PlayerAvatar
            key={p.seat}
            player={p}
            isOnTeam={proposedSet.has(p.seat)}
            isExcaliburHolder={p.seat === excaliburHolderSeat}
            isYou={p.seat === you.seat}
          />
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

      {you.isHost && hasStuckTeammate && (
        <div className="stuck-mission-notice">
          <p className="hint">
            Someone on this quest is disconnected and hasn&rsquo;t played a card. You can force it through — anyone
            still missing gets auto-played as Success on their behalf (or Fail, if they&rsquo;re Agravain).
          </p>
          <button type="button" className="btn btn-ghost" onClick={onForceResolve}>
            ⚡ Force-resolve stuck quest
          </button>
        </div>
      )}
    </div>
  );
}
