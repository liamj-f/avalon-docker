import React from 'react';

// Shared host-only "force this phase through" notice. MissionPanel,
// VotePanel, ExcaliburPanel, LadyOfLakePanel, and AssassinPanel each render
// one of these once there's an actual reason to (every gating condition --
// "is the relevant seat disconnected" -- lives with the caller, since it's
// different per phase), wired to one of the sp_force_* stored procedures.
// See the "Host escape hatches for a disconnected player mid-phase" design
// note in README for the reasoning behind each one's specific behavior.
//
// confirmMessage is required, deliberately -- these are irreversible,
// game-state-changing actions taken on someone else's behalf (one of them,
// AssassinPanel's force-pass, ends the game outright), so every caller has
// to actually decide what its own confirmation should say rather than one
// of them silently shipping without one.
export default function StuckPhaseNotice({ message, buttonLabel, confirmMessage, onClick, disabled }) {
  const handleClick = () => {
    if (window.confirm(confirmMessage)) onClick();
  };

  return (
    <div className="stuck-mission-notice">
      <p className="hint">{message}</p>
      <button type="button" className="btn btn-ghost" onClick={handleClick} disabled={disabled}>
        ⚡ {buttonLabel}
      </button>
    </div>
  );
}
