import React from 'react';

// The full secret-identity reveal. Visibility (and the small "tap to view"
// tab shown once dismissed) is owned by App.jsx now, not this component --
// it needs to live in the sticky header rather than float over the page
// with its own position:fixed tab, which used to land right on top of the
// Table Talk sidebar on any viewport narrower than the layout's own
// max-width. See styles.css's .header-role-tab for where it ended up.
export default function RoleCard({ you, players, onDismiss }) {
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

        <button type="button" className="btn btn-primary" onClick={onDismiss}>
          Got it, hide my role
        </button>
      </div>
    </div>
  );
}
