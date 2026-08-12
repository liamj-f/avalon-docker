import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

export default function AssassinPanel({ room, onAssassinate }) {
  const { game, players, you } = room;
  const isAssassin = you.roleId === 'ASSASSIN';
  const hasPairRoute = game.hasTristanIseult;

  // Mode is now an explicit, named choice -- not just "however many seats
  // happen to be clicked" -- matching sp_submit_assassination exactly:
  // name 1 seat in "merlin" mode (correct if it's Merlin, or Gawain if
  // he's in play), or name exactly 2 in "lovers" mode (correct only if
  // it's really Tristan & Iseult). Defaults to "merlin" since that's the
  // only mode at all when the pair isn't in play.
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
            Evil wins only if the guess matches the mode exactly{hasPairRoute ? ' — pick one below.' : '.'}
          </p>

          {hasPairRoute && (
            <div className="assassin-mode-picker">
              <button
                type="button"
                className={`assassin-mode ${mode === 'merlin' ? 'assassin-mode-active' : ''}`}
                onClick={() => selectMode('merlin')}
              >
                <strong>Guess Merlin</strong>
                <span>Name 1 player{game.hasGawain ? ' — Gawain also wins it' : ''}</span>
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
              : `Select 1 player you believe is Merlin${game.hasGawain ? ' — or Gawain' : ''} (${targets.length}/1 picked).`}
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
    </div>
  );
}
