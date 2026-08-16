import React, { useEffect, useRef, useState } from 'react';
import { useGame } from './store.jsx';
import Home from './pages/Home.jsx';
import Lobby from './pages/Lobby.jsx';
import Game from './pages/Game.jsx';
import RoleCard from './components/RoleCard.jsx';
import QuestThemeArt from './components/QuestThemeArt.jsx';
import PwaUpdatePrompt from './PwaUpdatePrompt.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { ROLE_TOGGLES, EXTENSION_TOGGLES, QUEST_FLAVOR } from './gameData.js';

const FULL_ROSTER = [...ROLE_TOGGLES, ...EXTENSION_TOGGLES];

// The footer used to always show a fixed default list, regardless of what a
// given room actually enabled -- misleading as soon as a game used Agravain,
// Arthur, Lancelot, Guinevere, or just left something off. This derives the
// real roster from the room's settings instead, live. Returns null pre-room
// (Home screen -- no room to reflect yet, so no footer at all) or when the
// host has hidden selections from this viewer (settings arrive blanked in
// that case -- see rooms.py's serialize_for_token).
function rosterText(room) {
  if (!room?.settings) return null;
  const active = FULL_ROSTER.filter((r) => room.settings[r.key]).map((r) => r.name);
  return active.length > 0 ? active.join(' · ') : null;
}

export default function App() {
  const { state, clearError } = useGame();
  const { connected, room, error } = state;

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  // The role reveal used to be its own position:fixed tab floating over
  // the page -- simple, but with no way to coordinate with the rest of the
  // layout it ended up landing right on top of the Table Talk sidebar on
  // any viewport between the game-layout's single-column breakpoint and
  // its own max-width (a very ordinary desktop window size). Living in the
  // header instead means it shares space with everything else the normal,
  // collision-free way, and the header being sticky keeps it just as
  // reachable without scrolling back up as the old floating tab was.
  const gameYou = room?.game?.you;
  const [roleCollapsed, setRoleCollapsed] = useState(true);
  const prevPhase = useRef(room?.phase);
  useEffect(() => {
    // A fresh game starting is exactly the moment `Game` used to mount
    // (and RoleCard along with it, resetting its own local state) -- this
    // reproduces that "show the full reveal once, up front, each game"
    // behavior now that the state lives up here instead.
    if (room?.phase === 'in_game' && prevPhase.current !== 'in_game') {
      setRoleCollapsed(false);
    }
    prevPhase.current = room?.phase;
  }, [room?.phase]);

  // Same clamp Game.jsx uses for the "Quest N of 5" line -- holds on the
  // 5th quest's theme once missionNumber ticks past it at game end, rather
  // than reading past the end of QUEST_FLAVOR.
  const questTheme =
    room?.phase === 'in_game' ? QUEST_FLAVOR[Math.min(room.game.missionNumber, 4)].theme : null;
  const roster = rosterText(room);

  return (
    <div className="app-shell">
      {questTheme && <QuestThemeArt theme={questTheme} variant="page" />}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ⚔️
          </span>
          <span className="brand-text">Avalon</span>
          <span className="brand-sub">The Resistance</span>
        </div>
        <div className="header-status">
          {gameYou && roleCollapsed && (
            <button type="button" className="header-role-tab" onClick={() => setRoleCollapsed(false)}>
              Your role: <strong>{gameYou.role}</strong> ({gameYou.team}) — tap to view
            </button>
          )}
          <div className={`conn-pill ${connected ? 'conn-ok' : 'conn-bad'}`}>
            {connected ? 'Connected' : 'Connecting…'}
          </div>
          <ThemeToggle />
        </div>
      </header>

      {gameYou && !roleCollapsed && (
        <RoleCard you={gameYou} players={room.players} onDismiss={() => setRoleCollapsed(true)} />
      )}

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

      {roster && (
        <footer className="app-footer">
          <span>{roster}</span>
        </footer>
      )}
    </div>
  );
}
