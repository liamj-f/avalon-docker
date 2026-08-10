"""Postgres connection pool + migration runner."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

import asyncpg

logger = logging.getLogger("avalon.db")

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # asyncpg returns jsonb as raw text by default; decode/encode it as plain
    # Python dict/list/etc so callers never have to think about it, matching
    # node-pg's default JSON auto-parsing.
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
        format="text",
    )


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.environ["DATABASE_URL"],
            init=_init_connection,
            min_size=1,
            max_size=10,
        )
    return _pool


async def wait_for_db(retries: int = 20, delay_seconds: float = 1.5) -> None:
    """Retries the initial DB connection while Postgres finishes starting up."""
    for attempt in range(1, retries + 1):
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return
        except Exception as err:  # noqa: BLE001 - deliberately broad; any failure means "not ready yet"
            logger.info("[db] not ready yet (attempt %d/%d): %s", attempt, retries, err)
            await asyncio.sleep(delay_seconds)
    raise RuntimeError("Could not connect to Postgres after multiple retries")


async def run_migrations() -> None:
    """Applies any migration files under ./migrations not yet recorded in schema_migrations, in filename order.

    Each migration runs inside its own transaction. Safe to run on every boot.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            """
        )

        files = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
        applied = {r["filename"] for r in await conn.fetch("SELECT filename FROM schema_migrations")}

        for filename in files:
            if filename in applied:
                continue
            sql = (MIGRATIONS_DIR / filename).read_text(encoding="utf-8")
            logger.info("[db] applying migration %s", filename)
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute("INSERT INTO schema_migrations (filename) VALUES ($1)", filename)
