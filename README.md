# Avalon: The Resistance — Multiplayer

A self-hosted, real-time multiplayer implementation of *The Resistance: Avalon*,
running as three Docker services: a React frontend, a Node/Socket.IO backend,
and a Postgres database that is the actual source of truth for every game in
progress — not just a history log.

## Features

- **Lobbies**: create a room, share a short code, friends join from any browser.
- **Role selection with a lobby poll**: the host has final say on which
  characters/extensions are in play, but every player can cast a non-binding
  👍 preference vote on each one — the host sees the tally live while deciding.
- **Host transfer**: the host can hand host duties to any other connected
  player at any point before the game starts.
- **Full character set**: Merlin, Percival, Morgana, Mordred, Oberon, Assassin,
  and Tristan & Iseult, on top of the base Loyal Servant of Arthur / Minion of
  Mordred roles. Supports 5–10 players with the standard Avalon mission/fail
  tables.
- **Extensions**: **Lady of the Lake** (checks a player's loyalty after
  missions 2/3/4, then passes to whoever was examined) and **Excalibur** (a
  Good player can cleanse one Fail off a mission, once per game), both
  toggleable from the lobby alongside the core roles.
- **Real-time gameplay** over WebSockets (Socket.IO): team building, public
  team votes, secret mission cards, the assassination phase, and a full
  role-reveal at game end.
- **Reconnect-friendly**: your seat is tied to a token stored in the browser,
  not the socket connection, so a refresh or dropped connection doesn't kick
  you from the game.
- **Table chat** alongside the game.

## Architecture — Postgres is the game

```
┌────────────┐      /api, /socket.io      ┌────────────┐   SQL calls   ┌────────────┐
│  frontend  │ ─────────────────────────▶ │  backend   │ ─────────────▶│     db     │
│ React+nginx│ ◀───────────────────────── │ Node+Socket│ ◀── NOTIFY ────│  Postgres  │
│  (port 80) │                            │.IO (:4000) │   (LISTEN)    │  (:5432)   │
└────────────┘                            └────────────┘               └────────────┘
```

Once a game starts, **Postgres holds the live state** — whose turn it is,
the current phase, every team proposal, every vote, every mission card,
who holds Lady of the Lake / Excalibur — and a set of PL/pgSQL **stored
procedures** (`backend/migrations/003_stored_procedures.sql`) is the only
thing allowed to mutate it. The backend's job shrinks to: call a stored
procedure, then read the resulting rows back and push them to the right
sockets. There's no separate in-memory "game engine" object — the database
*is* the engine.

Every mutating procedure ends with `pg_notify('avalon_game_updates', game_id)`,
and the backend keeps a dedicated `LISTEN` connection open
(`backend/src/gameNotify.js`). That means **you can drive a live game by hand
from `psql`** — the running app will update in real time, exactly as if a
player had clicked a button:

```sql
-- find the game_id for whatever room code is on someone's screen
SELECT id, phase, mission_number, leader_seat FROM games WHERE room_code = 'ABCDE';

-- vote to approve the currently-proposed team, as seat 2
SELECT sp_cast_team_vote('<game-id>', 2, true);

-- watch the app on your screen update instantly — nobody touched a socket
```

This is genuinely how the app drives itself too — a player clicking
"Approve" in the browser results in exactly this same function call. See
`backend/migrations/003_stored_procedures.sql` for the full set
(`sp_propose_team`, `sp_cast_team_vote`, `sp_cast_mission_card`,
`sp_excalibur_decision`, `sp_use_lady_of_lake`, `sp_submit_assassination`),
and `mission_config`/`games`/`game_players`/`team_votes`/`mission_cards`/
`lady_of_lake_events`/`excalibur_events` for the tables behind them —
all fair game to `SELECT` from directly to see exactly what state a game is in.

**Security note:** this trades secrecy for transparency on purpose. Anyone
with `psql` access can read every player's role and every vote directly out
of the tables — there's no row-level security here. That's fine for a
private/self-hosted deployment where the point is to let your team poke at
it, but don't expose this Postgres instance publicly.

**What stays in memory:** the lobby (who's connected, chat, the role
preference poll, who's host) lives in the backend's `RoomManager`
(`backend/src/rooms.js`), not Postgres. It's inherently tied to live socket
connections and doesn't need to survive a restart the way an in-progress
vote does — there's no lobby left to rejoin after a restart either way.

- `frontend/` — Vite + React SPA. nginx serves the static build and proxies
  `/api/*` and `/socket.io/*` to the backend, so the browser only ever talks
  to one origin.
- `backend/` — Express + Socket.IO, a thin layer over the stored procedures.
  `src/gameDb.js` calls them and reads back per-seat-redacted state;
  `src/gameNotify.js` bridges Postgres `NOTIFY` back to socket broadcasts.
  Migrations in `backend/migrations/` run automatically on boot.
- `db/` — plain `postgres:16-alpine`, no custom image needed; schema *and*
  game logic live in the backend's migrations, applied idempotently on boot.

## Running it

```bash
cp .env.example .env    # adjust POSTGRES_PASSWORD etc. if you like
docker compose up --build
```

Then open **http://localhost:8080** (or whatever `FRONTEND_PORT` you set).
Open it in a few browser tabs/devices to play with friends — need 5–10
players to start a game.

To stop: `docker compose down` (add `-v` to also drop the Postgres volume).

To poke at a running game's database directly:

```bash
docker compose exec db psql -U avalon -d avalon
```

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
      config.js      # mission team-size / fail tables (also mirrored in Postgres' mission_config)
      roles.js        # role metadata, dealing, knowledge computation — runs once at game start
    rooms.js           # in-memory lobby manager (players, chat, host, role poll)
    gameDb.js           # calls the sp_* stored procedures, reads back per-seat state
    gameNotify.js         # LISTEN avalon_game_updates -> re-broadcast to the right room
    socketHandlers.js      # Socket.IO event wiring
    db.js                   # pg pool + migration runner
    index.js                 # entrypoint
  migrations/
    001_init.sql              # base games/game_players/game_missions tables
    002_gameplay_schema.sql    # live-state columns + team_votes/mission_cards/lady/excalibur tables
    003_stored_procedures.sql   # the actual game engine, as PL/pgSQL
frontend/
  src/
    pages/            # Home, Lobby, Game
    components/        # TeamBuilder, VotePanel, MissionPanel, AssassinPanel, LadyOfLakePanel,
                        # ExcaliburPanel, EndScreen, RoleCard, MissionTrack, Chat, PlayerAvatar
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

**Win conditions**, both enforced inside `_resolve_mission` /
`sp_cast_team_vote` in Postgres:
- **Evil wins immediately on the 3rd failed quest.** (Confirmed working —
  see Verification below.)
- **Evil wins immediately if 5 team proposals in a row are rejected**
  (the standard Avalon rule — vote rejections don't fail a quest by
  themselves, only the vote *track* running out).
- **Good needs 3 successful missions** *and*, if the Assassin is in play,
  the Assassin failing to name Merlin afterwards (if the Assassin isn't in
  play, 3 successes wins outright).

### Design note: Tristan & Iseult

There are a few documented fan variants of this pair. This build uses the
straightforward one: Tristan and Iseult are both Loyal Servants of Arthur who
are told each other's identity at the start of the game (see
`computeKnowledge` in `backend/src/game/roles.js`). If you'd prefer a variant
where one of them can secretly be Evil, that function is the place to change it.

### Design note: Lady of the Lake

Implements the standard expansion rule: after missions 2, 3, and 4 (not 1 or
5), whoever holds the Lady of the Lake secretly checks one other player's
loyalty (Good/Evil, not their exact role), then the Lady passes to the
player they examined. It can never return to someone who's already held it.
The holder is public information (it's a token at the table); what they
learn is private to them.

### Design note: Excalibur

This is a fan mechanic with several incompatible variants in the wild, so
this build picks one and documents it rather than trying to reconcile all of
them: a Good player starts holding Excalibur. Any time a mission comes back
with at least one Fail and Excalibur hasn't been used yet, its holder is
asked whether to cleanse one Fail into a Success. Using it spends Excalibur
for the rest of the game. The holder is public information, like Lady of the
Lake; the exact pending fail count is private to the holder until they decide.

## Verification

No live Docker registry was reachable in the dev sandbox this was built in
(Docker Hub/GHCR were blocked by the sandbox's egress policy — confirmed via
a 403 policy denial, not a transient failure), so `docker compose build`
itself hasn't been run end-to-end here. Everything it depends on has been,
against a real local Postgres 16 and the real backend process (not mocks):

- **3 failed quests → Evil wins immediately**: explicitly tested — an 8/7-
  player game where Evil deliberately fails 3 missions ends with
  `winner=evil, winReason=missions` and exactly 3 failed entries in
  `game_missions`.
- **5 rejected team votes in a row → Evil wins** (`winReason=vote_track`),
  and a normal `winReason=missions`/`assassination` finish for Good — all
  driven through real Socket.IO clients end-to-end.
- **Lady of the Lake**: verified it only triggers after missions 2/3/4 (not
  1), correctly reveals the examined player's true team, passes the token
  to them, and rejects being passed back to a previous holder.
- **Excalibur**: verified the decision phase only triggers when a mission
  actually has a Fail, the holder sees the correct pending fail count,
  using it reduces the recorded fail count by exactly 1, and it's marked
  spent afterward.
- **Role preference poll and host transfer**: both verified over real
  sockets (vote tallies update live and don't affect actual settings; host
  status correctly moves between players).
- **The star feature — manual stored-procedure calls updating a live game**:
  ran a full game up to the assassination phase entirely through simulated
  players, then finished it with a raw `SELECT sp_submit_assassination(...)`
  from `psql` with **no socket connection involved at all**, and confirmed
  the running app updated instantly via the `LISTEN`/`NOTIFY` pipeline.
- Along the way this surfaced and fixed three real bugs: a PL/pgSQL variable
  shadowing a column name (`result`), a table/procedure column-name mismatch
  (`winning_team` vs `winner`), and a genuine concurrency bug where two
  broadcasts for the same room could complete out of order and overwrite a
  client's fresh state with a stale read — fixed by serializing broadcasts
  per room.
- Frontend: `npm run build` (Vite) completes cleanly.

Worth a real `docker compose up --build` on your machine before you consider
it done — the Dockerfiles are standard multi-stage Node/nginx builds and
everything they wrap has been verified directly, but the containers
themselves haven't been built in this environment.
