# Avalon: The Resistance — Multiplayer

A self-hosted, real-time multiplayer implementation of *The Resistance: Avalon*,
running as three Docker services: a React frontend, a Python (FastAPI +
python-socketio) backend, and a Postgres database that is the actual source
of truth for every game in progress — not just a history log.

## Features

- **Lobbies**: create a room, share a short code, friends join from any browser.
- **Role selection with a lobby poll**: the host has final say on which
  characters/extensions are in play, but every player can cast a non-binding
  👍 preference vote on each one — the host sees the tally live while deciding.
- **Host transfer**: the host can hand host duties to any other connected
  player at any point before the game starts.
- **Full character set**: Merlin, Percival, Morgana, Mordred, Oberon, Assassin,
  Tristan & Iseult, Agravain, Arthur, and Lancelot (solo, or the Good/Evil
  Lancelot pair + Guinevere), on top of the base Loyal Servant of Arthur /
  Minion of Mordred roles. Supports 5–10 players with the standard Avalon
  mission/fail tables.
- **Extensions**: **Lady of the Lake** (checks a player's loyalty after
  missions 2/3/4, then passes to whoever was examined) and **Excalibur**
  (each quest's leader hands it to someone else on that team before the
  vote; once the quest's cards are in, the holder sees every real card and
  may flip exactly one player's, once per game), both toggleable from the
  lobby alongside the core roles.
- **Real-time gameplay** over WebSockets (Socket.IO): team building, public
  team votes, secret mission cards, the assassination phase, and a full
  role-reveal at game end.
- **Reconnect-friendly**: your seat is tied to a token stored in the browser,
  not the socket connection, so a refresh or dropped connection doesn't kick
  you from the game.
- **Table chat** alongside the game.
- **Installable PWA**: add it to your phone/desktop home screen with its own
  icon and window, no browser chrome. Purely an app-shell/installability
  layer — see the design note below for why this can't and doesn't touch
  the Socket.IO connection.
- **Team vote history**: every past team proposal — leader, team, and how
  each seat voted — stays visible for the rest of the game, revealed all at
  once the instant a vote resolves (never dribbled out before everyone's
  in). The one attempt currently being voted on is never included until it
  resolves.
- **Quest results, in full, and reviewable all game long**: a dismissable
  popup announces each quest's outcome the moment it resolves, with the raw
  Success/Fail/Reverse card breakdown submitted — separate from the
  (possibly Excalibur-changed) effective result — plus who held Excalibur
  that quest, whether it was used, and on whom. Every resolved quest's pip
  on the mission track stays clickable for the rest of the game to reopen
  that same detail, so dismissing the popup doesn't lose it. Never forces a
  reload mid-decision; it's purely informational.
- **Hide role selections**: the host can toggle the character roster
  invisible to everyone else in the lobby until the game starts (their own
  view, and the vote tally, are unaffected) — for groups that don't want to
  telegraph the roster while people are still joining.

## Architecture — Postgres is the game

```
┌────────────┐      /api, /socket.io      ┌─────────────┐   SQL calls   ┌────────────┐
│  frontend  │ ─────────────────────────▶ │   backend   │ ─────────────▶│     db     │
│ React+nginx│ ◀───────────────────────── │  FastAPI +  │ ◀── NOTIFY ────│  Postgres  │
│  (port 80) │                            │python-socket│   (LISTEN)    │  (:5432)   │
│            │                            │io  (:4000)  │               │            │
└────────────┘                            └─────────────┘               └────────────┘
```

Once a game starts, **Postgres holds the live state** — whose turn it is,
the current phase, every team proposal, every vote, every mission card,
who holds Lady of the Lake / Excalibur — and a set of PL/pgSQL **stored
procedures** (`backend/migrations/002_procedures.sql`) is the only
thing allowed to mutate it. The backend's job shrinks to: call a stored
procedure, then read the resulting rows back and push them to the right
sockets. There's no separate in-memory "game engine" object — the database
*is* the engine.

Every mutating procedure ends with `pg_notify('avalon_game_updates', game_id)`,
and the backend keeps a dedicated `LISTEN` connection open via `asyncpg`
(`backend/src/game_notify.py`). That means **you can drive a live game by
hand from `psql`** — the running app will update in real time, exactly as if
a player had clicked a button:

```sql
-- find the game_id for whatever room code is on someone's screen
SELECT id, phase, mission_number, leader_seat FROM games WHERE room_code = 'ABCDE';

-- vote to approve the currently-proposed team, as seat 2
SELECT sp_cast_team_vote('<game-id>', 2, true);

-- watch the app on your screen update instantly — nobody touched a socket
```

This is genuinely how the app drives itself too — a player clicking
"Approve" in the browser results in exactly this same function call. See
`backend/migrations/002_procedures.sql` for the full set (`sp_propose_team`,
`sp_cast_team_vote`, `sp_cast_mission_card`, `sp_excalibur_decision`,
`sp_use_lady_of_lake`, `sp_submit_assassination`, `sp_reveal_arthur`), and
`backend/migrations/001_schema.sql` for the tables behind them —
`mission_config`/`games`/`game_players`/`team_votes`/`mission_cards`/
`lady_of_lake_events`/`excalibur_events` — all fair game to `SELECT` from
directly to see exactly what state a game is in.

**Security note:** this trades secrecy for transparency on purpose. Anyone
with `psql` access can read every player's role and every vote directly out
of the tables — there's no row-level security here. That's fine for a
private/self-hosted deployment where the point is to let your team poke at
it, but don't expose this Postgres instance publicly.

**What stays in memory:** the lobby (who's connected, chat, the role
preference poll, who's host) lives in the backend's `RoomManager`
(`backend/src/rooms.py`), not Postgres. It's inherently tied to live socket
connections and doesn't need to survive a restart the way an in-progress
vote does — there's no lobby left to rejoin after a restart either way.

- `frontend/` — Vite + React SPA (unchanged by the Python rewrite below —
  it talks Socket.IO's wire protocol, not any particular server language).
  nginx serves the static build and proxies `/api/*` and `/socket.io/*` to
  the backend, so the browser only ever talks to one origin.
- `backend/` — FastAPI (REST) + `python-socketio` (`AsyncServer`, ASGI mode)
  mounted on one app and served by `uvicorn`, a thin layer over the stored
  procedures. `src/game_db.py` calls them and reads back per-seat-redacted
  state; `src/game_notify.py` bridges Postgres `NOTIFY` back to socket
  broadcasts via `asyncpg`. Migrations in `backend/migrations/` run
  automatically on boot.
- `db/` — plain `postgres:16-alpine`, no custom image needed; schema *and*
  game logic live in the backend's migrations, applied idempotently on boot.

## Running it

`docker-compose.yml` runs the pre-built images published to GHCR (see
below) — nothing is built from source by default:

```bash
cp .env.example .env    # adjust POSTGRES_PASSWORD etc. if you like
docker compose up -d
```

Then open **http://localhost:8080** (or whatever `FRONTEND_PORT` you set).
Open it in a few browser tabs/devices to play with friends — need 5–10
players to start a game.

To stop: `docker compose down` (add `-v` to also drop the Postgres volume).

To poke at a running game's database directly:

```bash
docker compose exec db psql -U avalon -d avalon
```

To build from your own local changes instead of pulling, swap `image:` for
`build: ./backend` (or `./frontend`) in `docker-compose.yml` — each
service's Dockerfile comment notes this — then `docker compose up --build`.
For actively iterating on the code without a container rebuild each time,
see **Local development** below instead.

### Pre-built images (GHCR)

`.github/workflows/docker-publish.yml` builds `backend/` and `frontend/` as
separate images and pushes them to GitHub Container Registry on every push
to `main` (tagged `latest` and the short commit SHA) and on `v*.*.*` tags
(tagged with the semver version). Pull requests build the same way to catch
a broken Dockerfile, but never push. `docker-compose.yml` pins neither by
default (`${IMAGE_TAG:-latest}`) — set `IMAGE_TAG` in `.env` to a specific
short SHA or `v*.*.*` tag for a reproducible deploy instead of always
floating on `latest`.

```
ghcr.io/liamj-f/avalon-docker/backend:latest
ghcr.io/liamj-f/avalon-docker/frontend:latest
```

**New packages default to private**, regardless of the repo's own
visibility — until you change that (each package's GitHub page → Package
settings → Change visibility), `docker compose up` will fail to pull with
an auth error unless you're logged in: `docker login ghcr.io` (a GitHub PAT
with `read:packages` works as the password) before pulling.

Both images are published **multi-arch** (`linux/amd64` + `linux/arm64`, via
QEMU in the workflow) as a single manifest list per tag, so the same
`ghcr.io/liamj-f/avalon-docker/backend:latest` pulls the right variant
automatically whether the host is a normal x86_64 server, a Raspberry Pi, or
Apple Silicon — no separate `-arm64` tag to remember.

### Using an existing Postgres instance

By default `docker compose up` also starts its own `db` container with a
Docker-managed volume. If you'd rather point the app at Postgres you
already run elsewhere, use `docker-compose.external-db.yml` instead — it
has no `db:` service at all, just `backend` + `frontend`:

```bash
cp .env.external-db.example .env
# edit .env: DB_HOST, DB_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
docker compose -f docker-compose.external-db.yml up --build
```

This expects, as a **prerequisite**, that the `POSTGRES_DB` database and the
`POSTGRES_USER` service-account role already exist on that instance and
that the role can log in with `POSTGRES_PASSWORD` and has `CREATE` on that
database — the app never creates the database or role itself, only runs its
own migrations (`backend/migrations/*.sql`, idempotent, tracked in
`schema_migrations`) *inside* it on every boot, same as it does against the
bundled `db` container.

### Reverse-proxying through your own nginx container

If you already run an nginx (or Nginx Proxy Manager / Traefik / Caddy)
container for other sites and want it to reach the frontend container
directly over Docker's own network instead of going back out through the
host's published `FRONTEND_PORT`, add `docker-compose.proxy-network.yml` on
top of the base file:

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy-network.yml up -d
```

This attaches the frontend container (named `avalon-ui`, fixed by
`container_name:` in `docker-compose.yml`) to `PROXY_NETWORK` — an
**external** network your other nginx stack already created (set its name
in `.env`; see `.env.example`) — in addition to this stack's own network,
so `backend` communication is unaffected. Your other container can then
`proxy_pass http://avalon-ui:80;` directly — Docker resolves a container by
its `container_name` network-wide automatically, no IP address or extra
port-mapping needed. Full detail (including what to do if `avalon-ui`
collides with a same-named container on your other stack) is in the comment
at the top of `docker-compose.proxy-network.yml`.

Both container names (`avalon-backend`, `avalon-ui`) are fixed in
`docker-compose.yml` rather than left to Compose's auto-generated
`<project>-<service>-<n>` naming, for exactly this kind of external
tooling. `frontend/nginx.conf.template`'s own proxy target
(`BACKEND_HOST`/`BACKEND_PORT`, defaulting to `backend`/`4000` — Compose's
service-name alias, not the container name) is set to match
`avalon-backend` in `docker-compose.yml`'s `frontend.environment`, so
renaming either container only means updating that one place, not the
image itself.

### Progressive Web App

The frontend is installable (`vite-plugin-pwa`, generated at build time —
`frontend/src/PwaUpdatePrompt.jsx`, `frontend/public/*.png`,
`frontend/vite.config.js`'s `VitePWA` block). "Install app" from the browser
menu (or the address-bar icon on desktop Chrome/Edge) gets its own window
and home-screen/app-list icon, no browser chrome.

**This can't touch WebSockets even in principle**: a service worker's
`fetch` event — the only hook it has to intercept anything — never fires
for `ws://`/`wss://` connections; browsers exclude WebSocket traffic from
service worker interception entirely, by spec. Socket.IO's own polling
fallback and every `/api/` call are additionally set to `NetworkOnly` in
the Workbox config anyway (`vite.config.js`), so nothing here can serve a
stale room/vote response even for the HTTP-shaped requests — only the
static app shell (hashed JS/CSS/HTML, the manifest, the icons) is
precached.

The one real risk with any PWA is a stale cached bundle: mid-game, a naive
"new version available, reloading now" would drop a player's live socket
connection without warning. `registerType: 'prompt'` + `PwaUpdatePrompt.jsx`
avoid that — a new build installs itself in the background but sits
inactive as a dismissible toast until the player explicitly clicks reload
(e.g. between games), never forced. `frontend/nginx.conf.template` also
explicitly marks `/sw.js` and `/manifest.webmanifest` as `Cache-Control:
no-cache`, so that toast shows up promptly after a real deploy instead of
being delayed by an HTTP cache.

## Local development (without Docker)

```bash
# terminal 1: Postgres (or point DATABASE_URL at any Postgres you have)
docker compose up db

# terminal 2: backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd src
DATABASE_URL=postgres://avalon:change_me@localhost:5432/avalon PORT=4000 python main.py

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
      config.py       # mission team-size / fail tables (also mirrored in Postgres' mission_config)
      roles.py         # role metadata, dealing, knowledge computation — runs once at game start
    rooms.py            # in-memory lobby manager (players, chat, host, role poll)
    room_code.py         # short room-code generator
    game_db.py             # calls the sp_* stored procedures, reads back per-seat state
    game_notify.py           # asyncpg LISTEN avalon_game_updates -> re-broadcast to the right room
    socket_handlers.py         # python-socketio event wiring
    db.py                        # asyncpg pool + migration runner
    main.py                       # entrypoint: FastAPI + Socket.IO + uvicorn
  requirements.txt
  migrations/
    001_schema.sql        # every table: games, game_players, game_missions, team_votes,
                           # mission_cards, lady_of_lake_events, excalibur_events, mission_config
    002_procedures.sql     # the actual game engine, as PL/pgSQL stored procedures
    003_team_proposals.sql  # one row per team proposal (leader + team), so a resolved
                             # vote's per-seat choices can be shown back later -- see
                             # the Team vote history feature and its design note
frontend/
  src/
    pages/            # Home, Lobby, Game
    components/        # TeamBuilder, VotePanel, MissionPanel, AssassinPanel, LadyOfLakePanel,
                        # ExcaliburPanel, ArthurReveal, EndScreen, RoleCard, MissionTrack, Chat, PlayerAvatar,
                        # VoteHistory, QuestResultPopup
    store.jsx           # Socket.IO client + app state (React context)
    PwaUpdatePrompt.jsx  # "new version available" toast -- see PWA design note
  public/
    pwa-192x192.png, pwa-512x512.png,     # PWA install icons referenced from
    maskable-icon-512x512.png,            # frontend/vite.config.js's VitePWA manifest
    apple-touch-icon.png                  # block -- a crossed-swords glyph in the app's
                                           # own navy/gold theme colors
  nginx.conf.template  # SPA + reverse proxy to the backend; BACKEND_HOST/BACKEND_PORT
                        # substituted at container startup, not hardcoded; also serves
                        # sw.js/manifest.webmanifest (generated by the build) uncached
.github/workflows/
  docker-publish.yml    # builds + pushes multi-arch backend/frontend images to GHCR
docker-compose.yml
docker-compose.external-db.yml    # same app, no bundled `db` -- point it at Postgres you already run
docker-compose.proxy-network.yml  # add-on: attach `frontend` to your own nginx container's network
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
each require Merlin; Morgana requires Percival; Mordred requires Merlin;
Lancelot (solo) and the Good & Evil Lancelot pair each require Merlin;
Guinevere requires the Lancelot pair; **Lancelot (solo) and the Lancelot
pair are mutually exclusive** — pick one or the other, never both.

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
`compute_knowledge` in `backend/src/game/roles.py`). If you'd prefer a variant
where one of them can secretly be Evil, that function is the place to change it.

### Design note: Lady of the Lake

Implements the standard expansion rule: after missions 2, 3, and 4 (not 1 or
5), whoever holds the Lady of the Lake secretly checks one other player's
loyalty (Good/Evil, not their exact role), then the Lady passes to the
player they examined. It can never return to someone who's already held it.
The holder is public information (it's a token at the table); what they
learn is private to them.

### Design note: Excalibur

Originally implemented as an invented simplification (a single Good player
holding it for the whole game, only able to cleanse one Fail on a mission
that already had one). `004_excalibur_rework.sql` replaces that with the
real expansion rule:

- **Assigning**: every quest, whoever's proposing the team also designates
  one *other* player on that team (never themselves) to hold Excalibur for
  it — as long as it hasn't been spent yet. This is part of the team
  proposal itself (`sp_propose_team`'s new `p_excalibur_seat`), so everyone
  sees who'd hold it *before* voting on the team, exactly like the rule
  requires. If the team is rejected, the next leader assigns it fresh —
  nothing carries over between proposals.
- **Using**: once every participant's mission card is in, the holder sees
  everyone's real card (`you.excaliburParticipants` — the one place actual
  card values leave the mission-cards table pre-resolution) and may flip
  exactly one participant's card (Success↔Fail), or decline and change
  nothing. Choosing to use it always changes the target's card — there's no
  "look but don't touch" option, matching the source rule's "has the
  opportunity to change the submitted vote."
- **Lancelot's Reverse card**: Reverse has no natural opposite to flip to,
  so if the holder targets a Reverse card they explicitly pick Success or
  Fail instead of the sword picking one automatically — and that also
  strips the card's reverse behavior (a still-reversed card is what flips
  the quest's final result). Per the explicit instruction this was rebuilt
  against, **Lancelot's reverse-flip is evaluated after Excalibur's swap**,
  not before: `sp_excalibur_decision` updates `mission_cards` first, *then*
  recomputes the fail count and calls `_resolve_mission` — so if Excalibur
  left the Reverse card in place, the quest's raw fail tally still gets
  flipped by it as the very last step; if Excalibur converted it to a plain
  Success/Fail, there's no card left to flip and the mission resolves on
  the (now-final) real tally.
- **Single-use, forever**: spending it clears `games.excalibur_holder_seat`
  and sets `games.excalibur_used = true` for the rest of the game, same as
  before — just now assigned per-quest instead of fixed at game start.
- **Transparency**: once a quest resolves, everyone learns who held
  Excalibur, whether they used it, and — if so — who they targeted
  (`missionResults[].excaliburHolderSeat`/`excaliburUsed`/
  `excaliburTargetSeat`, all public). Nobody except the holder and the
  target ever learns the target's *original* card value
  (`you.excaliburReveals`, scoped to those two seats' own view only) —
  matching "only the Excalibur holder and the targeted individual know what
  the original vote was."
- **A leak avoided on purpose**: the public per-quest `cardCounts`
  (success/fail/reverse breakdown) always reflects the *current*, post-swap
  `mission_cards` state, never the original. If it showed the pre-swap tally
  alongside the public "who got targeted" fact, the target's secret original
  card would become arithmetically derivable by anyone at the table —
  so there is deliberately no "before" tally exposed anywhere but to the
  holder/target pair themselves.
- Excalibur assignment is validated server-side (`sp_propose_team`): the
  designated holder must be on the proposed team, must not be the leader,
  and is required whenever Excalibur is enabled and unspent — the frontend
  mirrors this in `TeamBuilder`'s `canPropose` gating, but the database is
  what actually enforces it.

### Design note: Agravain

A Minion of Mordred with no discretion: if Agravain is on a quest, the
server rejects any attempt by them to play Success (`sp_cast_mission_card`
checks `role = 'AGRAVAIN'`). No new UI is needed — Agravain simply doesn't
get offered a Success button while on a mission.

### Design note: Arthur

Once 2 quests have failed, Arthur can choose (`sp_reveal_arthur`) to
publicly reveal themselves as Good — visible to everyone via
`game.publicReveals`, independent of the current phase (you don't have to
wait for your turn). It's a one-way, one-time action. This is a fan concept
without one canonical rule set; the version here is deliberately simple —
a pure "confirmed good" flag with no other mechanical side effects — rather
than guessing at a more elaborate variant.

### Design note: Lancelot

Another fan mechanic with several incompatible real-world variants, so
this build picks one clean interpretation per mode and documents it:

- **Solo Lancelot** (`lancelot`): a Good player who appears to Merlin as
  Evil (a built-in red herring — see `compute_knowledge` in
  `backend/src/game/roles.py`), and who holds a single-use **Reverse**
  card. While on a quest, Lancelot can play Reverse instead of Success;
  it doesn't count as a Fail card itself, but flips that quest's final
  result (success/fail) after the normal tally. If both Lancelot and
  Excalibur are enabled, Excalibur resolves *first* — the holder can swap
  the Reverse card itself (converting it to a definite Success/Fail, no
  longer subject to flipping) or leave it alone, and only then does any
  remaining Reverse card flip the quest's outcome — see the Excalibur
  design note above for exactly why that ordering was chosen.
- **Good & Evil Lancelot pair** (`lancelotPair`): two separate Lancelot
  seats, one dealt Good and one dealt Evil. At a mission number chosen
  secretly at random when the game starts (`games.swap_mission_number`),
  the instant that mission resolves — win or lose — the two silently swap
  allegiance for the rest of the game (`_resolve_mission` in
  `002_procedures.sql`). Both appear to Merlin as Evil
  regardless of their current, real team. Knowledge granted at deal time
  (who evil teammates see, etc.) is **not** retroactively recomputed after
  a swap — only `team`, which every live rule check reads fresh from
  Postgres, actually changes. This is a deliberate simplification, not an
  oversight: modeling "what would Merlin have learned if the swap had
  already happened" would require re-deriving knowledge live, which adds
  real complexity for a fan mechanic without a single canonical rule to
  match against.
- **Guinevere** (`guinevere`, requires the pair): knows both Lancelots'
  seats, but never which is currently Good or Evil — implemented exactly
  like Percival's ambiguous Merlin/Morgana pair.
- **Solo Lancelot and the pair are mutually exclusive**, enforced in both
  `validate_settings` (backend) and `validateSettingsClient` (frontend) —
  see Verification below for the test covering this.

### Design note: Team vote history

`team_votes` alone was never enough to show a resolved vote back later — it
records who voted which way, but not who was leading or who was on the
team, and `games.proposed_team`/`leader_seat` get overwritten by the very
next proposal the instant one resolves. `003_team_proposals.sql` adds a
`team_proposals` table (one row per leader-proposal-attempt) specifically
so that context survives; `game_db.py`'s `voteHistory` query then joins it
against `team_votes`.

The one attempt currently being voted on is deliberately excluded from
`voteHistory` — real Avalon reveals a vote's individual choices the instant
everyone's in, all at once, never card-by-card as they arrive. `VotePanel`
still shows a live in-progress count (`votesInSoFar`/`hasVoted`) without
leaking anyone's actual choice early; `voteHistory` only ever contains
fully-resolved attempts.

`team_proposals.excalibur_seat` (added in `004_excalibur_rework.sql`) rides
along in the same row as the team/leader/attempt, so each `voteHistory`
entry also carries `excaliburSeat` — the proposed Excalibur holder is
public before the vote happens, so there's nothing to hide here even for
the in-progress attempt (`VotePanel` shows it as a live hint; `VoteHistory`
shows it per past entry).

### Design note: Quest result cards vs. the effective result

`game_missions.fail_count` is the *effective* fail count — after any
Excalibur swap — used to decide `result`. The per-quest `cardCounts`
(`success`/`fail`/`reverse`) are computed separately, straight from the
*current* `mission_cards` rows (post-swap, see the Excalibur design note's
leak-avoidance note above for why not pre-swap), and reflect what's true at
resolution time. Both are aggregate-only queries (`GROUP BY
mission_number`): who played which card stays secret even though the tally
is public the moment a quest resolves.

Both the auto-popup and every resolved quest's pip on the mission track
render through the same stateless `QuestResultModal`, driven by one piece
of state in `Game.jsx` (`openQuestNumber`) — a `missionResults.length`
growing opens the newest quest automatically (matching the previous
just-resolved popup behavior); clicking any earlier resolved pip opens that
one instead. Dismissing never discards the underlying data, so every past
quest (and its Excalibur usage) stays reachable for the rest of the game.

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
- **Excalibur (full rework)**: verified over real Socket.IO clients plus
  direct `psql` role-forcing (to deterministically reach the rare
  Lancelot+Excalibur interaction, since normal role dealing is random):
  proposing a team without designating a holder (while Excalibur is active
  and unspent) is rejected; designating the leader themselves, or someone
  not on the proposed team, is rejected; the decision phase now triggers on
  *every* quest once a holder is assigned, not just ones with a Fail
  already in; the holder's view shows every participant's real card;
  flipping a Success to Fail (and vice versa) updates `mission_cards` and
  the mission's effective result correctly; declining leaves the quest's
  cards untouched; using it is correctly rejected a second time in the same
  game once already spent; and transparency holds exactly as specified —
  bystanders see holder/used/target after the fact but never the target's
  original card, while the holder and target's own `you.excaliburReveals`
  correctly includes it. Both branches of the Lancelot Reverse interaction
  were explicitly tested: Excalibur declining to touch the Reverse card
  (the quest's outcome still flips, regression-safe) and Excalibur
  explicitly converting the Reverse card to Success/Fail (the quest
  resolves on that real tally directly, no double-flip) — confirming the
  required "Lancelot's reverse evaluates after Excalibur's swap" ordering.
- **Role preference poll and host transfer**: both verified over real
  sockets (vote tallies update live and don't affect actual settings; host
  status correctly moves between players).
- **Agravain**: the server rejects an attempted Success play while on a
  quest, and a forced Fail correctly fails that quest.
- **Arthur**: reveal attempts before 2 quests have failed are rejected;
  after 2 fails, revealing succeeds and shows up in `publicReveals` with
  the correct role/team.
- **Lancelot (solo)**: confirmed Merlin's knowledge includes Lancelot's
  seat as Evil despite Lancelot truly being Good; the Reverse card flips an
  all-success mission to Fail without itself counting as a fail card, is
  marked used (`lancelotReverseUsed`), and a second use is rejected.
- **Lancelot pair + Guinevere**: confirmed Merlin sees both Lancelots as
  Evil; Guinevere's knowledge names both seats with no team-identifying
  label; and — across repeated runs to force both outcomes — that the
  automatic swap, when its randomly-chosen mission is reached, correctly
  flips both Lancelots' current teams (confirmed in the final reveal), and
  that a run where the swap mission falls after the game already ended
  correctly leaves teams unchanged.
- **Exclusivity/dependencies**: solo Lancelot + the Lancelot pair together
  is rejected at game start; Guinevere without the pair is rejected.
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
- **The Node → Python backend rewrite**: verified by re-running the exact
  same Socket.IO test suites above (win conditions, reconnect, chat, every
  new-role mechanic, and the manual-psql/`LISTEN`-`NOTIFY` bridge) against
  the new `python-socketio` server, unchanged — proving the frontend and
  the Postgres engine genuinely don't care which language sits between
  them. This surfaced one more real bug: under rapid connect/disconnect
  churn (e.g. one lobby finishing while the next forms), broadcasting via
  `sio.emit(..., to=player.socket_id)` could occasionally deliver a
  message to the wrong, since-reused connection — root-caused with
  targeted logging, fixed by switching to Socket.IO's own per-player room
  membership (`sio.enter_room`/`emit(room=...)`, keyed by the stable
  player token) instead of threading a captured sid through our own
  `Player` object over time; room membership is maintained by the library
  itself and dropped automatically on disconnect, so it can't go stale the
  way a manually-cached sid string could. 30+ rapid back-to-back lobby
  creations reproduced the bug reliably before the fix and zero times
  after, across repeated runs.
- Frontend: `npm run build` (Vite) completes cleanly, unmodified by the
  backend rewrite.
- **Excalibur rework + persistent quest history UI, visually**: driven
  through a real 5-browser-context Playwright session (Chromium) against
  the actual dev server and backend, screenshotting each new surface —
  `TeamBuilder`'s Excalibur-holder picker, `VotePanel`'s proposed-holder
  hint, the quest-result popup showing "Excalibur held by X — used on Y",
  `VoteHistory`'s "Excalibur to X" line, and clicking a resolved mission
  pip to reopen that same detail later in the game, confirming the popup's
  dismissal on one player's screen doesn't affect another's independent
  copy of the same modal.
- **Multi-arch publishing + the external-Postgres compose file**: the
  workflow YAML parses and `docker compose -f docker-compose.external-db.yml
  config` resolves correctly with `DB_HOST`/`POSTGRES_*` set (producing the
  expected `DATABASE_URL`, no `db:` service, no stray `depends_on: db`) and
  fails fast with a clear message when any of them are missing, both
  confirmed directly; actually pushing a manifest list to GHCR and pulling
  it on real arm64/amd64 hosts hasn't been (no registry egress in this
  sandbox, same constraint as below).
- **PWA**: `npm run build` produces the expected `sw.js`/`manifest.webmanifest`/
  icon files in `dist/`, and the generated service worker was inspected
  directly to confirm both the navigation-fallback denylist and an explicit
  `NetworkOnly` rule cover `/api/` and `/socket.io/` (the app makes no
  direct `fetch()` calls at all today — everything is Socket.IO — so this
  is deliberately defensive against future `/api/` usage, not fixing an
  active gap). `npm run dev` also starts and serves cleanly with the PWA
  plugin active, confirming the dev-mode virtual module doesn't error even
  though the service worker only actually registers in a production build.
  Not verified: installing the built app in a real browser (again, no
  registry access in this sandbox to build/run the actual container) — a
  quick real-device install/reload-prompt check is worth doing once this
  reaches a live deploy.
- **Team vote history, quest result cards, hide role selections**: verified
  against a real local Postgres 16 instance and the real backend process
  (not mocks), driven by real Socket.IO clients — confirmed the in-progress
  attempt never appears in `voteHistory`, a rejected attempt records all 5
  seats' actual choices correctly, `voteHistory` accumulates correctly
  across multiple attempts, and `cardCounts` is correct for both an
  all-success quest and one with a Fail card (including the quest actually
  failing, since a 5-player quest 1 only needs 1 Fail). Also driven through
  a real Chromium browser (Playwright, 5 real tabs/players) end to end:
  screenshotted the host's view while toggling roles and hiding selections,
  the non-host's view showing the hidden-selections banner and blanked
  toggles, the dynamic footer correctly reflecting a custom roster (and
  correctly falling back to the generic text when hidden), the Team vote
  history card rendering a real rejected proposal with per-seat vote chips,
  and the quest-result popup rendering with its card breakdown after a real
  quest resolved.

Worth a real `docker compose up -d` (pulling the published GHCR images) or
`docker compose up --build` (after swapping `image:` for `build:` in
`docker-compose.yml`) on your machine before you consider it done — the
Dockerfiles are a standard `python:3.12-slim` + `pip install` build and a
multi-stage Node/nginx build respectively, and everything they wrap has been
verified directly (including a real `pip install` from PyPI into a venv),
but the containers themselves haven't been built in this environment.
