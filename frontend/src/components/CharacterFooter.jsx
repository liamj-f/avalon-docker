import React, { useEffect, useState } from 'react';
import { EXTENSION_TOGGLES, fullRoster } from '../gameData.js';

// The footer used to always show a fixed default list of the toggled
// special characters, regardless of what a given room actually enabled --
// misleading as soon as a game used Agravain, Arthur, Lancelot, Guinevere,
// or just left something off, and even at its most complete it never said
// how many plain Loyal Servants / Minions were sitting among them, only
// the named specials. This derives the real, full roster -- specials plus
// fillers, and the Good/Evil headcount they add up to -- from the room's
// settings and player count instead, live, plus whichever extensions
// (Lady of the Lake, Excalibur) are on, which don't take a Good/Evil slot
// so aren't part of fullRoster's count. Returns null pre-room (Home screen
// -- no room to reflect yet, so no footer at all), when the host has
// hidden selections from this viewer (settings arrive blanked in that case
// -- see rooms.py's serialize_for_token), or for an unsupported player
// count (shouldn't happen in-game, but fullRoster guards it regardless).
function roomRoster(room) {
  if (!room?.settings || !room?.players) return null;
  const roster = fullRoster(room.players.length, room.settings);
  if (!roster) return null;
  const extensions = EXTENSION_TOGGLES.filter((r) => room.settings[r.key]).map((r) => ({ ...r, count: 1 }));
  return { ...roster, items: [...roster.items, ...extensions] };
}

// Pressing a name expands its description below the list -- this used to
// be static, unclickable text, which meant actually checking what e.g.
// Agravain or Guinevere does required leaving to check the rules. One
// entry open at a time; pressing the already-open one again collapses it.
//
// Only shown once a game is actually underway. In the lobby, the Roles
// panel already shows every enabled character with its full description
// visible at all times (plus the vote tally and the host's own toggle
// controls) -- a compact, click-to-expand duplicate of that same
// information in the footer would be redundant there, not useful the way
// it is mid-game once the Roles panel is gone.
export default function CharacterFooter({ room }) {
  const roster = room?.phase === 'in_game' ? roomRoster(room) : null;
  const items = roster?.items ?? [];
  // items is a fresh array every render, so this keys off a stable
  // signature of which characters are actually active rather than array
  // identity -- otherwise the effect below would fire on every render,
  // closing the description the instant it opened.
  const rosterSignature = items.map((r) => r.key).join(',');
  const [openKey, setOpenKey] = useState(null);
  useEffect(() => {
    setOpenKey(null);
  }, [rosterSignature]);

  if (!roster) return null;
  const openRole = items.find((r) => r.key === openKey) || null;

  return (
    <footer className="app-footer">
      <div className="app-footer-summary">
        <span className="team-chip team-chip-good">{roster.good} Good</span>
        <span className="team-chip team-chip-evil">{roster.evil} Evil</span>
      </div>
      <div className="app-footer-roster">
        {items.map((r, i) => (
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
              {r.count > 1 && <span className="app-footer-role-count"> ×{r.count}</span>}
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
