import React from 'react';
import { QUEST_FLAVOR } from '../gameData.js';

/**
 * Full detail for one resolved quest -- the raw success/fail/reverse card
 * breakdown (see game_db.py's cardCounts) plus whatever's publicly known
 * about Excalibur on that quest: the holder always views exactly one
 * participant's card before deciding, so the viewed target is public
 * either way -- "X viewed Y's card but did not use Excalibur" or "X used
 * Excalibur to change Y's card". The card's actual value stays private to
 * the holder and target themselves, in you.excaliburReveals.
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
        <p className="hint">
          Quest {result.missionNumber + 1}: {QUEST_FLAVOR[result.missionNumber].name} — result
        </p>
        <h2 className={`quest-result-title quest-result-title-${result.result}`}>
          {isSuccess ? '✅ Success' : '❌ Fail'}
        </h2>
        <p className="quest-result-breakdown">
          {success} Success &middot; {fail} Fail{reverse > 0 ? ` · ${reverse} Reverse` : ''} submitted
        </p>

        {result.excaliburHolderSeat != null && result.excaliburTargetSeat != null && (
          <p className="quest-result-excalibur">
            ⚔️ <strong>{nameFor(result.excaliburHolderSeat)}</strong> viewed{' '}
            <strong>{nameFor(result.excaliburTargetSeat)}</strong>&rsquo;s card
            {result.excaliburUsed ? ' and used Excalibur to change it.' : ', but did not use Excalibur.'}
          </p>
        )}

        <button type="button" className="btn btn-primary" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
