"""Entrypoint: waits for Postgres, runs migrations, wires up the Socket.IO
server + REST endpoints, bridges Postgres NOTIFY back to socket broadcasts,
and serves everything over one ASGI app via uvicorn.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import UTC, datetime
from uuid import UUID

import socketio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import run_migrations, wait_for_db
from game_notify import attach_game_listener
from rooms import RoomManager
from socket_handlers import create_socket_server

# Always log to stdout (docker logs / Portainer). Additionally log to a file
# under LOG_DIR so log-file-based tools (e.g. fail2ban) can tail it; this is
# best-effort so a missing/read-only LOG_DIR degrades to stdout-only rather
# than crashing the app.
LOG_DIR = os.environ.get("LOG_DIR", "/app/logs")
_log_handlers: list[logging.Handler] = [logging.StreamHandler()]
try:
    os.makedirs(LOG_DIR, exist_ok=True)
    _log_handlers.append(logging.FileHandler(os.path.join(LOG_DIR, "access.log")))
except OSError:
    logging.getLogger("avalon.server").warning(
        "could not open LOG_DIR %s for writing; file logging disabled", LOG_DIR
    )

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    handlers=_log_handlers,
)
logger = logging.getLogger("avalon.server")


class _HealthCheckAccessFilter(logging.Filter):
    """Docker's healthcheck (docker-compose*.yml) polls /api/health every
    10s -- uvicorn's own access logger (a separate logger from everything
    above, with its own handler attached during startup, not one of
    _log_handlers) would otherwise log every single one of those at INFO,
    burying real request logs under a constant drip of healthcheck noise.
    Filters by the formatted message rather than parsing record.args --
    uvicorn's access log record shape isn't a stable public API, but every
    version puts the request path in the rendered message somewhere."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "/api/health" not in record.getMessage()

PORT = int(os.environ.get("PORT", "4000"))
CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "*")
REAP_INTERVAL_SECONDS = 30 * 60

room_manager = RoomManager()
sio, broadcast_room = create_socket_server(room_manager)

fastapi_app = FastAPI()
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_ORIGIN == "*" else [CORS_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "time": datetime.now(UTC).isoformat()}


@fastapi_app.get("/api/rooms/{code}/exists")
async def room_exists(code: str) -> dict:
    room = room_manager.rooms.get(code.upper())
    return {"exists": room is not None, "phase": room.phase if room else None}


# Socket.IO mounted alongside the REST routes on one ASGI app, matching the
# default client path (/socket.io/) that nginx already proxies.
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="socket.io")


async def _on_game_changed(payload: str) -> None:
    """Bridges Postgres back to the sockets: any stored procedure that
    mutates a game ends with pg_notify(...), whether it was called by the
    app or by hand from psql, and this pushes the resulting state to
    everyone in that game's room."""
    try:
        game_id = UUID(payload)
    except ValueError:
        logger.warning("[server] ignoring malformed game id in notification: %r", payload)
        return
    room = room_manager.find_room_by_game_id(game_id)
    if room is not None:
        await broadcast_room(room)


async def _reap_loop() -> None:
    while True:
        await asyncio.sleep(REAP_INTERVAL_SECONDS)
        room_manager.reap_empty_rooms()


async def main() -> None:
    logger.info("[server] waiting for Postgres...")
    await wait_for_db()
    logger.info("[server] running migrations...")
    await run_migrations()

    attach_game_listener(_on_game_changed)
    asyncio.create_task(_reap_loop())

    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info",
        # Trusts X-Forwarded-For from *any* peer, which would be dangerous
        # on a backend directly reachable from the internet -- a client
        # could just lie about its own IP. It isn't, here: docker-compose.yml
        # never publishes a host port for this service, so nginx (which
        # sets X-Forwarded-For itself, overwriting rather than appending --
        # see nginx.conf.template) is the only thing that can ever reach it.
        # uvicorn's own default (trust only 127.0.0.1) would be *wrong* for
        # that setup, since nginx is a separate container reached over the
        # compose network, not loopback.
        forwarded_allow_ips="*",
    )
    server = uvicorn.Server(config)
    # uvicorn.Server.__init__ -> Config.load() has already run
    # configure_logging() by this point, attaching its own console handler
    # to "uvicorn.access" -- adding the filter only now (rather than at
    # module import time, before that handler exists) means it survives
    # uvicorn's own logging setup instead of being wiped by it.
    logging.getLogger("uvicorn.access").addFilter(_HealthCheckAccessFilter())
    logger.info("[server] Avalon backend listening on :%s", PORT)
    await server.serve()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        logger.exception("[server] fatal startup error")
        raise
