import React from 'react';

export default function MissionTrack({ game }) {
  const { teamSizes, failsRequired, missionResults, missionNumber, rejectionCount } = game;

  return (
    <div className="mission-track">
      <div className="mission-pips">
        {teamSizes.map((size, i) => {
          const result = missionResults.find((m) => m.missionNumber === i);
          const isCurrent = i === missionNumber && game.phase !== 'game_over';
          let cls = 'mission-pip';
          if (result) cls += result.result === 'success' ? ' pip-success' : ' pip-fail';
          else if (isCurrent) cls += ' pip-current';
          return (
            <div key={i} className={cls} title={`Mission ${i + 1}: ${size} players, ${failsRequired[i]} fail(s) needed`}>
              <span className="pip-size">{size}</span>
              {failsRequired[i] > 1 && <span className="pip-badge">2 fails</span>}
            </div>
          );
        })}
      </div>
      <div className="reject-track">
        <span className="reject-label">Rejected teams</span>
        <div className="reject-pips">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`reject-pip ${i < rejectionCount ? 'reject-pip-hit' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
