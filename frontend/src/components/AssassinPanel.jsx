import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function AssassinPanel({ room, onAssassinate, onForcePass }) {
  const { game, players, you } = room;
  const isAssassin = you.roleId === 'ASSASSIN';
  const hasPairRoute = game.hasTristanIseult;

  // Mode is now an explicit, named choice -- not just "however many seats
  // happen to be clicked" -- matching sp_submit_assassination exactly:
  // name 1 seat in "merlin" mode, or name exactly 2 in "lovers" mode
  // (correct only if it's really Tristan & Iseult). Defaults to "merlin"
  // since that's the only mode at all when the pair isn't in play.
  //
  // Gawain is deliberately never mentioned here even when he's in play:
  // naming him in "guess Merlin" mode wins the game for Gawain himself,
  // not Evil (sp_submit_assassination tracks that as its own `winner`,
  // separate from a correct Merlin guess) -- but the Assassin is always
  // trying to identify Merlin specifically, never "Merlin or Gawain" as a
  // target, so surfacing him here would just be an unearned hint. That's
  // also why the framing below only ever promises Evil the win for a
  // correct guess, never for "any guess that matches the mode" -- naming
  // Gawain matches the mode's shape but isn't Evil's win.
  const [mode, setMode] = useState('merlin');
  const [targets, setTargets] = useState([]);
  const modeTargetCount = mode === 'lovers' ? 2 : 1;

  const selectMode = (m) => {
    setMode(m);
    setTargets([]); // switching modes changes the required count, so any in-progress pick no longer makes sense
  };

  const toggleTarget = (seat) => {
    setTargets((prev) => {
      if (prev.includes(seat)) return prev.filter((s) => s !== seat);
      if (prev.length >= modeTargetCount) return [...prev.slice(1), seat];
      return [...prev, seat];
    });
  };

  const canSubmit = targets.length === modeTargetCount;
  const submitLabel = mode === 'lovers' ? 'Name as Tristan & Iseult' : 'Name as Merlin';

  return (
    <div className="phase-panel">
      <h2 className="phase-title">Good has won 3 quests — but the Assassin gets one shot</h2>

      {!isAssassin && (
        <p className="phase-lead">The Assassin is choosing whether — and who — to name. Hold your breath.</p>
      )}

      {isAssassin && (
        <>
          <p className="phase-lead">
            Name the wrong person and Good&rsquo;s win stands. Evil only wins outright with a correct guess
            {hasPairRoute ? ' — pick a mode below.' : '.'}
          </p>

          {hasPairRoute && (
            <div className="assassin-mode-picker">
              <button
                type="button"
                className={`assassin-mode ${mode === 'merlin' ? 'assassin-mode-active' : ''}`}
                onClick={() => selectMode('merlin')}
              >
                <strong>Guess Merlin</strong>
                <span>Name 1 player</span>
              </button>
              <button
                type="button"
                className={`assassin-mode ${mode === 'lovers' ? 'assassin-mode-active' : ''}`}
                onClick={() => selectMode('lovers')}
              >
                <strong>Guess the Lovers</strong>
                <span>Name exactly 2 — must be Tristan &amp; Iseult</span>
              </button>
            </div>
          )}

          <p className="hint">
            {mode === 'lovers'
              ? `Select exactly 2 players you believe are Tristan & Iseult (${targets.length}/2 picked).`
              : `Select 1 player you believe is Merlin (${targets.length}/1 picked).`}
          </p>
        </>
      )}

      <div className="avatar-grid">
        {players
          .filter((p) => p.seat !== you.seat || !isAssassin)
          .map((p) => (
            <PlayerAvatar
              key={p.seat}
              player={p}
              isYou={p.seat === you.seat}
              isSelected={targets.includes(p.seat)}
              selectable={isAssassin}
              onClick={() => toggleTarget(p.seat)}
            />
          ))}
      </div>

      {isAssassin && (
        <div className="vote-buttons">
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => onAssassinate(targets)}>
            {submitLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onAssassinate([])}>
            🏳️ Pass — let Good’s win stand
          </button>
        </div>
      )}

      {you.isHost && !isAssassin && game.assassinDisconnected && (
        <div className="stuck-mission-notice">
          <p className="hint">
            The Assassin is disconnected. You can force this through — it always resolves as a Pass (Good&rsquo;s win
            stands), the same as the Assassin choosing not to guess. There&rsquo;s no way to force a name on their
            behalf — nobody but the Assassin themselves knows who they are.
          </p>
          <button type="button" className="btn btn-ghost" onClick={onForcePass}>
            ⚡ Force-resolve: pass
          </button>
        </div>
      )}
    </div>
  );
}
