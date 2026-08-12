import React, { useEffect } from 'react';
import { useGame } from './store.jsx';
import Home from './pages/Home.jsx';
import Lobby from './pages/Lobby.jsx';
import Game from './pages/Game.jsx';
import PwaUpdatePrompt from './PwaUpdatePrompt.jsx';
import { ROLE_TOGGLES, EXTENSION_TOGGLES } from './gameData.js';

const DEFAULT_ROSTER_TEXT = 'Merlin · Percival · Morgana · Mordred · Oberon · Assassin · Tristan & Iseult';
const FULL_ROSTER = [...ROLE_TOGGLES, ...EXTENSION_TOGGLES];

// The footer used to always show that fixed default list, regardless of
// what a given room actually enabled -- misleading as soon as a game used
// Agravain, Arthur, Lancelot, Guinevere, or just left something off. This
// derives the real roster from the room's settings instead, live. Falls
// back to the generic list only pre-room (Home screen, nothing to reflect
// yet) or when the host has hidden selections from this viewer (settings
// arrive blanked in that case -- see rooms.py's serialize_for_token).
function rosterText(room) {
  if (!room?.settings) return DEFAULT_ROSTER_TEXT;
  const active = FULL_ROSTER.filter((r) => room.settings[r.key]).map((r) => r.name);
  return active.length > 0 ? active.join(' · ') : DEFAULT_ROSTER_TEXT;
}

export default function App() {
  const { state, clearError } = useGame();
  const { connected, room, error } = state;

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ⚔️
          </span>
          <span className="brand-text">Avalon</span>
          <span className="brand-sub">The Resistance</span>
        </div>
        <div className={`conn-pill ${connected ? 'conn-ok' : 'conn-bad'}`}>
          {connected ? 'Connected' : 'Connecting…'}
        </div>
      </header>

      {error && (
        <div className="toast toast-error" onClick={clearError} role="alert">
          {error}
        </div>
      )}

      <PwaUpdatePrompt />

      <main className="app-main">
        {!room && <Home />}
        {room && room.phase === 'lobby' && <Lobby />}
        {room && room.phase === 'in_game' && <Game />}
      </main>

      <footer className="app-footer">
        <span>{rosterText(room)}</span>
      </footer>
    </div>
  );
}
