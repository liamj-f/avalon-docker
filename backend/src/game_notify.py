"""Keeps a dedicated LISTEN connection open on 'avalon_game_updates'.

Every stored procedure that mutates a game ends with pg_notify(...), so this
fires whenever a game changes -- whether that change came from a player's
socket action or from someone running `SELECT sp_...(...)` by hand in psql.
Either way, `on_game_changed(game_id_text)` re-broadcasts fresh state to
that game's room.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Awaitable, Callable

import asyncpg

logger = logging.getLogger("avalon.gameNotify")

GameChangedCallback = Callable[[str], Awaitable[None]]

CHANNEL = "avalon_game_updates"
RECONNECT_DELAY_SECONDS = 2
PING_INTERVAL_SECONDS = 5


class GameListener:
    def __init__(self, on_game_changed: GameChangedCallback) -> None:
        self._on_game_changed = on_game_changed
        self._stopped = False
        self._task: asyncio.Task | None = None
        self._conn: asyncpg.Connection | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopped = True
        if self._task is not None:
            self._task.cancel()
        if self._conn is not None and not self._conn.is_closed():
            await self._conn.close()

    async def _run(self) -> None:
        while not self._stopped:
            try:
                await self._connect_and_listen()
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001 - any failure here just means "reconnect"
                logger.error("[gameNotify] listener error, reconnecting in %ss: %s", RECONNECT_DELAY_SECONDS, err)
            if not self._stopped:
                await asyncio.sleep(RECONNECT_DELAY_SECONDS)

    async def _connect_and_listen(self) -> None:
        conn = await asyncpg.connect(dsn=os.environ["DATABASE_URL"])
        self._conn = conn
        try:
            def on_notify(connection: asyncpg.Connection, pid: int, channel: str, payload: str) -> None:
                if channel != CHANNEL:
                    return
                asyncio.create_task(self._safe_handle(payload))

            await conn.add_listener(CHANNEL, on_notify)
            logger.info("[gameNotify] listening for game updates")

            # Passive LISTEN alone won't surface a silently-dropped
            # connection; a light periodic query both keeps the connection
            # alive and raises promptly if it's actually gone, triggering
            # the reconnect loop in _run().
            while not self._stopped:
                await asyncio.sleep(PING_INTERVAL_SECONDS)
                await conn.execute("SELECT 1")
        finally:
            self._conn = None
            if not conn.is_closed():
                await conn.close()

    async def _safe_handle(self, payload: str) -> None:
        try:
            await self._on_game_changed(payload)
        except Exception:  # noqa: BLE001 - a bad notification must never kill the listener
            logger.exception("[gameNotify] error handling notification")


def attach_game_listener(on_game_changed: GameChangedCallback) -> GameListener:
    listener = GameListener(on_game_changed)
    listener.start()
    return listener
