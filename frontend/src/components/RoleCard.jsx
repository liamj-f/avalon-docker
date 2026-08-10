import React, { useState } from 'react';

export default function RoleCard({ you, players }) {
  // `collapsed` starts false so every player sees the full reveal once, up
  // front, before tucking it away into the small tab.
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button type="button" className="role-reveal-tab" onClick={() => setCollapsed(false)}>
        Your role: <strong>{you.role}</strong> ({you.team}) — tap to view
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className={`modal role-modal role-modal-${you.team}`}>
        <p className="hint">Your secret identity</p>
        <h2 className="role-name">{you.role}</h2>
        <span className={`team-chip team-chip-${you.team}`}>{you.team === 'good' ? 'Loyal to Arthur' : 'Minion of Mordred'}</span>
        <p className="role-desc">{you.description}</p>

        {you.knowledge.length > 0 ? (
          <div className="knowledge-box">
            <h3>What you know</h3>
            <ul>
              {you.knowledge.map((k) => {
                const p = players.find((pl) => pl.seat === k.seat);
                return (
                  <li key={k.seat}>
                    <strong>{p?.displayName}</strong> — {k.label}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="hint">You have no special knowledge this game. Watch the votes closely.</p>
        )}

        <button type="button" className="btn btn-primary" onClick={() => setCollapsed(true)}>
          Got it, hide my role
        </button>
      </div>
    </div>
  );
}
