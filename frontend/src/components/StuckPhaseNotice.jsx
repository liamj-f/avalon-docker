import React from 'react';

// Shared host-only "force this phase through" notice. MissionPanel,
// VotePanel, ExcaliburPanel, LadyOfLakePanel, and AssassinPanel each render
// one of these once there's an actual reason to (every gating condition --
// "is the relevant seat disconnected" -- lives with the caller, since it's
// different per phase), wired to one of the sp_force_* stored procedures.
// See the "Host escape hatches for a disconnected player mid-phase" design
// note in README for the reasoning behind each one's specific behavior.
export default function StuckPhaseNotice({ message, buttonLabel, onClick, disabled }) {
  return (
    <div className="stuck-mission-notice">
      <p className="hint">{message}</p>
      <button type="button" className="btn btn-ghost" onClick={onClick} disabled={disabled}>
        ⚡ {buttonLabel}
      </button>
    </div>
  );
}
