# Avalon: The Resistance — Multiplayer

A self-hosted, real-time multiplayer implementation of *The Resistance: Avalon*,
running as three Docker services: a React frontend, a Node/Socket.IO backend,
and a Postgres database for game history.

## Features

- **Lobbies**: create a room, share a short code, friends join from any browser.
  Host toggles which characters are in play before starting.
- **Full character set**: Merlin, Percival, Morgana, Mordred, Oberon, Assassin,
  and Tristan & Iseult, on top of the base Loyal Servant of Arthur / Minion of
  Mordred roles. Supports 5–10 players with the standard Avalon mission/fail
  tables.
- **Real-time gameplay** over WebSockets (Socket.IO): team building, public
  team votes, secret mission cards, the assassination phase, and a full
  role-reveal at game end.
- **Reconnect-friendly**: your seat is tied to a token stored in the browser,
  not the socket connection, so a refresh or dropped connection doesn't kick
  you from the game.
- **Postgres-backed history**: every finished game (roles, missions, outcome)
  is written to Postgres, so lobby/game data survives a backend restart and
  can be queried later.
- **Table chat** alongside the game.

### Roadmap: Excalibur

Excalibur is not implemented yet. The intended design (documented here so it's
easy to pick up later): after mission 2, Good is handed the sword and may pass
it to any player for the following mission; whoever holds it may reveal one
player's true loyalty, or flip the outcome of one mission card. Slotting it in
means extending `AvalonGame` in `backend/src/game/engine.js` with an
`excalibur_holder` sub-phase between missions and a new `game:useExcalibur`
socket event — the redaction logic in `serializeForSeat` and the settings
validation in `roles.js` are already structured to make that a self-contained
addition rather than a rewrite.

### Design note: Tristan & Iseult

There are a few documented fan variants of this pair. This build uses the
straightforward one: Tristan and Iseult are both Loyal Servants of Arthur who
are told each other's identity at the start of the game (see
`computeKnowledge` in `backend/src/game/roles.js`). If you'd prefer a variant
where one of them can secretly be Evil, that function is the place to change it.

## Architecture

```
┌────────────┐      /api, /socket.io      ┌────────────┐      SQL      ┌────────────┐
│  frontend  │ ─────────────────────────▶ │  backend   │ ─────────────▶│     db     │
│ React+nginx│ ◀───────────────────────── │ Node+Socket│ ◀─────────────│  Postgres  │
│  (port 80) │                            │.IO (:4000) │               │  (:5432)   │
└────────────┘                            └────────────┘               └────────────┘
```

- `frontend/` — Vite + React SPA. nginx serves the static build and proxies
  `/api/*` and `/socket.io/*` to the backend, so the browser only ever talks
  to one origin.
- `backend/` — Express + Socket.IO. Live game/lobby state lives in memory
  (it's small, ephemeral, and extremely write-heavy — a poor fit for a DB
  round-trip on every vote); Postgres stores completed games for history.
  Migrations in `backend/migrations/` run automatically on boot.
- `db/` — plain `postgres:16-alpine`, no custom image needed; schema lives in
  the backend's migrations so it's applied idempotently on every start.

## Running it

```bash
cp .env.example .env    # adjust POSTGRES_PASSWORD etc. if you like
docker compose up --build
```

Then open **http://localhost:8080** (or whatever `FRONTEND_PORT` you set).
Open it in a few browser tabs/devices to play with friends — need 5–10
players to start a game.

To stop: `docker compose down` (add `-v` to also drop the Postgres volume).

## Local development (without Docker)

```bash
# terminal 1: Postgres (or point DATABASE_URL at any Postgres you have)
docker compose up db

# terminal 2: backend
cd backend
npm install
DATABASE_URL=postgres://avalon:change_me@localhost:5432/avalon npm run dev

# terminal 3: frontend
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api and /socket.io to :4000
```

## Project layout

```
backend/
  src/
    game/
      config.js     # mission team-size / fail tables per player count
      roles.js       # role metadata, dealing, knowledge computation
      engine.js       # the game state machine (AvalonGame)
    rooms.js          # lobby/room manager, player tokens/seats
    socketHandlers.js # Socket.IO event wiring
    persistence.js    # writes finished games to Postgres
    db.js              # pg pool + migration runner
    index.js            # entrypoint
  migrations/*.sql
frontend/
  src/
    pages/            # Home, Lobby, Game
    components/        # TeamBuilder, VotePanel, MissionPanel, AssassinPanel,
                        # EndScreen, RoleCard, MissionTrack, Chat, PlayerAvatar
    store.jsx           # Socket.IO client + app state (React context)
docker-compose.yml
```

## Rules reference (as implemented)

| Players | Good | Evil | Mission sizes | Fails needed |
|---|---|---|---|---|
| 5 | 3 | 2 | 2,3,2,3,3 | 1,1,1,1,1 |
| 6 | 4 | 2 | 2,3,4,3,4 | 1,1,1,1,1 |
| 7 | 4 | 3 | 2,3,3,4,4 | 1,1,1,**2**,1 |
| 8 | 5 | 3 | 3,4,4,5,5 | 1,1,1,**2**,1 |
| 9 | 6 | 3 | 3,4,4,5,5 | 1,1,1,**2**,1 |
| 10 | 6 | 4 | 3,4,4,5,5 | 1,1,1,**2**,1 |

Role dependencies enforced when starting a game: Percival and the Assassin
each require Merlin; Morgana requires Percival; Mordred requires Merlin.
Evil wins immediately on 3 failed missions or 5 rejected team proposals in a
row. Good needs 3 successful missions *and* the Assassin failing to name
Merlin (if the Assassin isn't in play, 3 successes wins outright).

## Verification

This was built and tested without a live Docker registry available in the
dev sandbox (outbound access to Docker Hub/GHCR/etc. was blocked by the
sandbox's egress policy), so `docker compose build` itself hasn't been run
end-to-end here. Everything it depends on has been:

- Backend: full Node syntax check on every file, plus a unit test suite for
  the game engine (role dealing/counts, all knowledge rules including
  Tristan & Iseult, mission win/loss, the 5-rejection vote track, and both
  assassination outcomes).
- Frontend: `npm run build` (Vite) completes cleanly.
- Full stack: ran the real backend against a local Postgres, exercised it
  with a genuine Socket.IO client over 7 simulated players end-to-end
  (create room → join → configure roles → start → 3 missions →
  assassination → game over), and confirmed the finished game, its players/
  roles, and its missions landed correctly in Postgres.

Worth a real `docker compose up --build` on your machine before you consider
it done — the Dockerfiles are standard multi-stage Node/nginx builds, so it
should Just Work, but it hasn't been run inside a container itself.
