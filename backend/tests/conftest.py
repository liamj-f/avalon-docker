"""Shared pytest fixtures for the stored-procedure test suite.

These tests deliberately go around the whole Python app -- no FastAPI, no
Socket.IO, not even rooms.py's in-memory Room -- and call the SQL functions
in backend/migrations/*.sql directly, exactly the way backend/src/game_db.py
does. That's the actual game engine (see README's "Postgres is the game");
testing it here means testing it once, not re-deriving it through sockets.
It also means these tests double as the migration files' own test suite --
every one of them starts by running the real migration runner (db.py's
`run_migrations`, unmodified) against a brand new database, so a migration
that fails to apply cleanly fails every test in this suite immediately.

Needs a reachable Postgres server to create per-test databases against --
set TEST_ADMIN_DATABASE_URL to point at one (defaults to the same
password/port docker-compose.yml's bundled `db` service uses locally).
Each test function gets its own freshly created, freshly migrated database,
dropped again afterward, so tests can never leak game state into each
other or depend on run order.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import asyncpg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import db  # noqa: E402
from db import _init_connection  # noqa: E402

ADMIN_DATABASE_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://postgres:avalon_dev@localhost:5432/postgres"
)


@pytest.fixture
async def pool():
    """An asyncpg pool for a freshly created, freshly migrated database, unique to this test."""
    db_name = f"avalon_test_{uuid.uuid4().hex[:16]}"
    base_dsn = ADMIN_DATABASE_URL.rsplit("/", 1)[0]

    admin_conn = await asyncpg.connect(dsn=ADMIN_DATABASE_URL)
    try:
        await admin_conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await admin_conn.close()

    test_dsn = f"{base_dsn}/{db_name}"
    # db.get_pool() caches its pool at module level, keyed on nothing --
    # calling it twice with different DATABASE_URLs in the same process
    # (i.e. across two tests) would silently hand the second test the
    # first test's pool, pointed at its now-dropped database. Reset it so
    # run_migrations() (which calls get_pool() internally) is forced to
    # build a fresh one against *this* test's database.
    db._pool = None
    prev_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = test_dsn
    try:
        await db.run_migrations()
    finally:
        if prev_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = prev_database_url
        if db._pool is not None:
            await db._pool.close()
            db._pool = None

    p = await asyncpg.create_pool(dsn=test_dsn, init=_init_connection, min_size=1, max_size=4)
    try:
        yield p
    finally:
        await p.close()
        admin_conn = await asyncpg.connect(dsn=ADMIN_DATABASE_URL)
        try:
            # Force-disconnect anything still attached (a leaked connection
            # from a failed test would otherwise make this hang or error).
            await admin_conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", db_name
            )
            await admin_conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
        finally:
            await admin_conn.close()
