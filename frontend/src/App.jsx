import React, { useEffect } from 'react';
import { useGame } from './store.jsx';
import Home from './pages/Home.jsx';
import Lobby from './pages/Lobby.jsx';
import Game from './pages/Game.jsx';

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

      <main className="app-main">
        {!room && <Home />}
        {room && room.phase === 'lobby' && <Lobby />}
        {room && room.phase === 'in_game' && <Game />}
      </main>

      <footer className="app-footer">
        <span>Merlin &middot; Percival &middot; Morgana &middot; Mordred &middot; Oberon &middot; Assassin &middot; Tristan &amp; Iseult</span>
      </footer>
    </div>
  );
}
