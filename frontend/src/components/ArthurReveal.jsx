import React from 'react';

/** Persistent control shown to Arthur once 2 quests have failed — not tied to any particular phase. */
export default function ArthurReveal({ game, you, onReveal }) {
  if (you.roleId !== 'ARTHUR' || you.revealed || game.phase === 'game_over') return null;

  const fails = game.missionResults.filter((m) => m.result === 'fail').length;
  if (fails < 2) return null;

  return (
    <div className="arthur-reveal-box">
      <p className="hint">
        Two quests have failed. As Arthur, you may reveal yourself to rally Good — but it also tells Evil exactly
        who you are.
      </p>
      <button type="button" className="btn btn-primary" onClick={onReveal}>
        👑 Reveal myself as Arthur
      </button>
    </div>
  );
}
