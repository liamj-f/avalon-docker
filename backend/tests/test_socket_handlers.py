"""Pure-Python unit tests for socket_handlers.py's non-socketio helpers. No
database, no event loop, no Socket.IO server -- these are plain functions.

Covers _client_ip specifically as a regression test: engineio's ASGI environ
translation (engineio/async_drivers/asgi.py:translate_request) hardcodes
environ["REMOTE_ADDR"] to the literal string "127.0.0.1" and never reads
scope["client"], which silently broke fail2ban/abuse-log attribution --
every connection's IP was logged as 127.0.0.1 regardless of the real client
or of uvicorn's ProxyHeadersMiddleware (main.py's forwarded_allow_ips)
correctly resolving X-Forwarded-For. The fix reads the already-resolved
client from environ["asgi.scope"]["client"] instead, which is what these
tests pin down.
"""

from socket_handlers import _client_ip

# ---------------------------------------------------------------------------
# _client_ip
# ---------------------------------------------------------------------------


def test_client_ip_reads_asgi_scope_not_remote_addr():
    """The real bug: REMOTE_ADDR is present (as engineio always sets it) but
    wrong -- _client_ip must ignore it in favor of asgi.scope['client']."""
    environ = {
        "REMOTE_ADDR": "127.0.0.1",
        "asgi.scope": {"client": ("46.65.240.112", 51000)},
    }
    assert _client_ip(environ) == "46.65.240.112"


def test_client_ip_missing_asgi_scope_key():
    environ = {"REMOTE_ADDR": "127.0.0.1"}
    assert _client_ip(environ) == "unknown"


def test_client_ip_asgi_scope_present_but_no_client():
    """E.g. a Unix socket or a scope type engineio built without one."""
    environ = {"asgi.scope": {}}
    assert _client_ip(environ) == "unknown"


def test_client_ip_asgi_scope_client_explicitly_none():
    environ = {"asgi.scope": {"client": None}}
    assert _client_ip(environ) == "unknown"


def test_client_ip_ignores_port():
    environ = {"asgi.scope": {"client": ("203.0.113.5", 443)}}
    assert _client_ip(environ) == "203.0.113.5"
