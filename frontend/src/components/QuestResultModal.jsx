import React from 'react';

/**
 * Full detail for one resolved quest -- the raw success/fail/reverse card
 * breakdown (see game_db.py's cardCounts) plus whatever's publicly known
 * about Excalibur on that quest (holder, whether used, and who it was used
 * on -- never the target's original card; that stays private to the holder
 * and target themselves, in you.excaliburReveals).
 *
 * Stateless and controlled by the parent: Game.jsx decides *which* quest
 * (if any) is open, both for the "just resolved" auto-popup and for
 * clicking back through old quests on the mission track.
 */
export default function QuestResultModal({ result, players, onClose }) {
  if (!result) return null;

  const { success, fail, reverse } = result.cardCounts || { success: 0, fail: 0, reverse: 0 };
  const isSuccess = result.result === 'success';
  const nameFor = (seat) => players.find((p) => p.seat === seat)?.displayName || `Seat ${seat}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal quest-result-modal quest-result-${result.result}`} onClick={(e) => e.stopPropagation()}>
        <p className="hint">Quest {result.missionNumber + 1} result</p>
        <h2 className={`quest-result-title quest-result-title-${result.result}`}>
          {isSuccess ? '✅ Success' : '❌ Fail'}
        </h2>
        <p className="quest-result-breakdown">
          {success} Success &middot; {fail} Fail{reverse > 0 ? ` · ${reverse} Reverse` : ''} submitted
        </p>

        {result.excaliburHolderSeat != null && (
          <p className="quest-result-excalibur">
            ⚔️ Excalibur held by <strong>{nameFor(result.excaliburHolderSeat)}</strong>
            {result.excaliburUsed ? (
              <>
                {' '}
                — used on <strong>{nameFor(result.excaliburTargetSeat)}</strong>
              </>
            ) : (
              ' — not used'
            )}
          </p>
        )}

        <button type="button" className="btn btn-primary" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
