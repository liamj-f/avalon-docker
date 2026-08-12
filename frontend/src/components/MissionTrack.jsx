import React from 'react';

export default function MissionTrack({ game, onSelectQuest }) {
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

          const title = `Quest ${i + 1}: ${size} players, ${failsRequired[i]} fail(s) needed${
            result ? ' — click to see the result' : ''
          }`;

          // Resolved quests are re-openable so the breakdown (and Excalibur
          // usage) stays reachable after the auto-popup is dismissed --
          // that persistent view is the whole point, see QuestResultModal.
          if (result) {
            return (
              <button type="button" key={i} className={cls} title={title} onClick={() => onSelectQuest(i)}>
                <span className="pip-size">{size}</span>
                {failsRequired[i] > 1 && <span className="pip-badge">2 fails</span>}
              </button>
            );
          }
          return (
            <div key={i} className={cls} title={title}>
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
