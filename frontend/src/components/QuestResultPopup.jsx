import React, { useEffect, useRef, useState } from 'react';

/**
 * A dismissable popup announcing a quest's result the instant it resolves,
 * with the raw success/fail/reverse card breakdown (see game_db.py's
 * cardCounts). Only ever fires for a quest that finishes *after* this
 * component mounts -- seenCountRef starts at the current length, not 0, so
 * reconnecting mid-game doesn't immediately greet you with a popup for old
 * news.
 */
export default function QuestResultPopup({ game }) {
  const results = game.missionResults;
  const seenCountRef = useRef(results.length);
  const [popup, setPopup] = useState(null);

  useEffect(() => {
    if (results.length > seenCountRef.current) {
      setPopup(results[results.length - 1]);
    }
    seenCountRef.current = results.length;
    // Only the count matters for "did a new one just land" -- re-running
    // this for every unrelated game update would be wasted work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length]);

  if (!popup) return null;

  const { success, fail, reverse } = popup.cardCounts || { success: 0, fail: 0, reverse: 0 };
  const isSuccess = popup.result === 'success';

  return (
    <div className="modal-backdrop">
      <div className={`modal quest-result-modal quest-result-${popup.result}`}>
        <p className="hint">Quest {popup.missionNumber + 1} result</p>
        <h2 className={`quest-result-title quest-result-title-${popup.result}`}>
          {isSuccess ? '✅ Success' : '❌ Fail'}
        </h2>
        <p className="quest-result-breakdown">
          {success} Success &middot; {fail} Fail{reverse > 0 ? ` · ${reverse} Reverse` : ''} submitted
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setPopup(null)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
