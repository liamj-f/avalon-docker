import React, { useEffect, useState } from 'react';
import { ROLE_TOGGLES, EXTENSION_TOGGLES } from '../gameData.js';

const FULL_ROSTER = [...ROLE_TOGGLES, ...EXTENSION_TOGGLES];

// The footer used to always show a fixed default list, regardless of what a
// given room actually enabled -- misleading as soon as a game used Agravain,
// Arthur, Lancelot, Guinevere, or just left something off. This derives the
// real roster from the room's settings instead, live. Returns null pre-room
// (Home screen -- no room to reflect yet, so no footer at all) or when the
// host has hidden selections from this viewer (settings arrive blanked in
// that case -- see rooms.py's serialize_for_token).
export function activeRoster(room) {
  if (!room?.settings) return null;
  const active = FULL_ROSTER.filter((r) => room.settings[r.key]);
  return active.length > 0 ? active : null;
}

// Pressing a name expands its description below the list -- this used to
// be static, unclickable text, which meant actually checking what e.g.
// Agravain or Guinevere does required leaving to check the rules. One
// entry open at a time; pressing the already-open one again collapses it.
export default function CharacterFooter({ room }) {
  const roster = activeRoster(room);
  // roster is a fresh array every render, so this keys off a stable
  // signature of which characters are actually active rather than array
  // identity -- otherwise the effect below would fire on every render,
  // closing the description the instant it opened.
  const rosterSignature = roster ? roster.map((r) => r.key).join(',') : '';
  const [openKey, setOpenKey] = useState(null);
  useEffect(() => {
    setOpenKey(null);
  }, [rosterSignature]);

  if (!roster) return null;
  const openRole = roster.find((r) => r.key === openKey) || null;

  return (
    <footer className="app-footer">
      <div className="app-footer-roster">
        {roster.map((r, i) => (
          <React.Fragment key={r.key}>
            {i > 0 && (
              <span className="app-footer-sep" aria-hidden="true">
                &middot;
              </span>
            )}
            <button
              type="button"
              className={`app-footer-role ${openKey === r.key ? 'app-footer-role-active' : ''}`}
              aria-expanded={openKey === r.key}
              onClick={() => setOpenKey((k) => (k === r.key ? null : r.key))}
            >
              {r.name}
            </button>
          </React.Fragment>
        ))}
      </div>
      {openRole && (
        <p className="app-footer-description">
          <strong>{openRole.name}:</strong> {openRole.description}
        </p>
      )}
    </footer>
  );
}
