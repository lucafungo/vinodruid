# Wine data onboarding portal - FastAPI backend.
# Handles auth (Auth0 JWT verification + user provisioning), org/user-scoped
# session & row data, admin management endpoints, and master reference data.
import os
import json
import ssl
import time
import urllib.request as _urllib
from contextlib import contextmanager
from typing import Any, Optional

import queue
import threading
import pyodbc
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt as _jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse


load_dotenv(override=True)

# In production, disable FastAPI's auto-generated /docs, /redoc and /openapi.json —
# they expose the full API schema (all routes, params, response shapes) to anyone
# without requiring a token. Fine for local dev; must be off before going live.
_is_production = os.getenv("ENVIRONMENT", "development").lower() == "production"
app = FastAPI(
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)

# CORS: locked to the specific frontend origin(s) defined in CORS_ORIGINS.
# In local dev the Vite server can run on 5173-5175; in production set this
# to the Azure Static Web App domain only. Never use "*" in production.
_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://localhost:5175",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# Security headers on every response: prevent MIME sniffing, clickjacking,
# and referrer leakage. HSTS is omitted here — Azure Front Door / App Service
# enforces HTTPS and sends HSTS at the TLS termination layer.
class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["server"] = "vinoDruid"  # mask uvicorn fingerprint
        return response

app.add_middleware(_SecurityHeadersMiddleware)


# Request body size cap: rejects payloads over 50 MB before they hit any
# endpoint. Protects against memory exhaustion from oversized JSON uploads.
_MAX_BODY_BYTES = int(os.getenv("MAX_BODY_MB", "50")) * 1024 * 1024

class _MaxBodySizeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            cl = request.headers.get("content-length")
            if cl and int(cl) > _MAX_BODY_BYTES:
                return StarletteResponse("Request body too large.", status_code=413)
        return await call_next(request)

app.add_middleware(_MaxBodySizeMiddleware)

# SQL Server connection settings (local SQL Server Express instance by default)
SERVER = os.getenv("SQL_SERVER", r"WOLUCA\SQLEXPRESS")
DATABASE = os.getenv("SQL_DATABASE", "WineOnboarding")
DRIVER = os.getenv("SQL_DRIVER", "ODBC Driver 17 for SQL Server")


# Auth0 config: used to verify incoming JWTs (see _verify_token) and to look
# up the signing keys (see _get_jwks).
_AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "")
_AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")
# When true, skip Auth0 entirely and use a fixed dev org/user (local dev only)
_SKIP_AUTH = os.getenv("SKIP_AUTH", "false").lower() == "true"
# Guard: SKIP_AUTH must never be enabled in production
if _SKIP_AUTH and os.getenv("ENVIRONMENT", "development").lower() == "production":
    raise RuntimeError("SKIP_AUTH=true is not allowed in production. Unset it in Azure App Service configuration.")
_jwks_cache: dict = {}
_jwks_cache_time: float = 0.0
_JWKS_TTL_SECONDS = 86400  # refresh Auth0 signing keys every 24 hours

# Auth0 Management API credentials: used only to auto-provision new users
# (see _get_mgmt_token / _provision_auth0_user, called from admin_create_user)
_AUTH0_MGMT_CLIENT_ID = os.getenv("AUTH0_MGMT_CLIENT_ID", "")
_AUTH0_MGMT_CLIENT_SECRET = os.getenv("AUTH0_MGMT_CLIENT_SECRET", "")
_mgmt_token_cache: dict = {}


# Fetches (and caches in-memory) Auth0's public signing keys (JWKS), used by
# _verify_token to check JWT signatures. Called indirectly via _resolve_user.
def _get_jwks() -> dict:
    global _jwks_cache, _jwks_cache_time
    stale = time.time() - _jwks_cache_time > _JWKS_TTL_SECONDS
    if (not _jwks_cache or stale) and _AUTH0_DOMAIN:
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
            with _urllib.urlopen(f"https://{_AUTH0_DOMAIN}/.well-known/jwks.json", timeout=10, context=ctx) as resp:
                _jwks_cache = json.loads(resp.read())
                _jwks_cache_time = time.time()
        except Exception as exc:
            if _jwks_cache:
                pass  # serve stale cache rather than breaking all auth
            else:
                raise HTTPException(status_code=503, detail=f"Could not reach Auth0 JWKS endpoint: {exc}")
    return _jwks_cache


# Verifies a raw JWT (signature, audience, issuer) and returns its claims.
# Called by _resolve_user, which every request-scoped endpoint depends on
# (via get_org_id / get_user_id / _require_admin) unless _SKIP_AUTH is set.
def _verify_token(token: str) -> dict:
    try:
        jwks = _get_jwks()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"JWKS fetch failed: {exc}")
    try:
        header = _jwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token.")
    # Match the token's key id (kid) against Auth0's published keys
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")), None)
    if not key:
        raise HTTPException(status_code=401, detail="Signing key not found.")
    rsa_key = {k: key[k] for k in ("kty", "kid", "use", "n", "e") if k in key}
    try:
        return _jwt.decode(token, rsa_key, algorithms=["RS256"],
                           audience=_AUTH0_AUDIENCE, issuer=f"https://{_AUTH0_DOMAIN}/")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token invalid: {exc}")


# Gets (and caches) an Auth0 Management API access token via client-credentials
# grant. Only used by _provision_auth0_user when auto-creating users.
def _get_mgmt_token() -> str:
    global _mgmt_token_cache
    import time, certifi, urllib.parse
    # Reuse cached token until it's about to expire (60s safety margin)
    if _mgmt_token_cache.get("token") and _mgmt_token_cache.get("expires_at", 0) > time.time() + 60:
        return _mgmt_token_cache["token"]
    payload = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": _AUTH0_MGMT_CLIENT_ID,
        "client_secret": _AUTH0_MGMT_CLIENT_SECRET,
        "audience": f"https://{_AUTH0_DOMAIN}/api/v2/",
    }).encode()
    ctx = ssl.create_default_context(cafile=certifi.where())
    req = _urllib.Request(
        f"https://{_AUTH0_DOMAIN}/oauth/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with _urllib.urlopen(req, timeout=10, context=ctx) as resp:
            data = json.loads(resp.read())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Auth0 management token fetch failed: {exc}")
    _mgmt_token_cache = {"token": data["access_token"], "expires_at": time.time() + data.get("expires_in", 86400)}
    return _mgmt_token_cache["token"]


# Creates a new Auth0 user (called from admin_create_user when an admin adds
# a user with an email) and returns a password-setup URL valid for 7 days.
def _provision_auth0_user(email: str) -> str:
    """Creates a new Auth0 user and returns a password-setup URL valid for 7 days."""
    import certifi, secrets, urllib.error
    token = _get_mgmt_token()
    ctx = ssl.create_default_context(cafile=certifi.where())

    # Random throwaway password - the user sets their real one via the ticket URL below
    create_payload = json.dumps({
        "email": email,
        "connection": "Username-Password-Authentication",
        "password": secrets.token_urlsafe(32),
        "email_verified": True,
    }).encode()
    req = _urllib.Request(
        f"https://{_AUTH0_DOMAIN}/api/v2/users",
        data=create_payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _urllib.urlopen(req, timeout=10, context=ctx) as resp:
            user_data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")
        if exc.code == 409:
            raise HTTPException(status_code=409, detail=f"User already exists in Auth0: {email}")
        raise HTTPException(status_code=502, detail=f"Auth0 user creation failed ({exc.code}): {body_text}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Auth0 user creation failed: {exc}")

    # Password-change ticket doubles as an invite/setup link (ttl_sec = 7 days)
    ticket_payload = json.dumps({
        "user_id": user_data["user_id"],
        "mark_email_as_verified": True,
        "ttl_sec": 604800,
    }).encode()
    req = _urllib.Request(
        f"https://{_AUTH0_DOMAIN}/api/v2/tickets/password-change",
        data=ticket_payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _urllib.urlopen(req, timeout=10, context=ctx) as resp:
            ticket_data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")
        raise HTTPException(status_code=502, detail=f"Auth0 password ticket creation failed ({exc.code}): {body_text}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Auth0 password ticket creation failed: {exc}")

    return ticket_data["ticket"]


# Core auth entry point: validates the request's bearer token (or falls back
# to a dev org/user when _SKIP_AUTH) and looks up the matching local user row
# by email, so downstream code can scope everything to org_id/user_id.
# Used by nearly every endpoint via get_org_id / get_user_id / _require_admin.
def _resolve_user(request: Request) -> tuple:
    """Returns (org_id, user_id, user_access). Caches result on request.state to avoid repeat DB lookups."""
    if hasattr(request.state, "_vd_user"):
        return request.state._vd_user

    if _SKIP_AUTH:
        result = (int(os.getenv("DEV_ORG_ID", "1")), int(os.getenv("DEV_USER_ID", "1")), "admin")
        request.state._vd_user = result
        return result

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    claims = _verify_token(auth[7:])
    email = claims.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Token does not contain email claim.")

    # Auth0 only proves identity (email) - the local users table is the source
    # of truth for which organisation/user record that email maps to
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT user_id, organisation_id, user_access FROM users WHERE email = ? AND disabled = 0", (email,)
        )
        user = row_as_dict(cursor)

    if not user:
        raise HTTPException(status_code=403, detail="Access denied.")

    result = (user["organisation_id"], user["user_id"], user.get("user_access", ""))
    request.state._vd_user = result
    return result


# Shorthand for the current request's organisation id (used throughout for
# scoping queries to the caller's org). Wraps _resolve_user.
def get_org_id(request: Request) -> int:
    return _resolve_user(request)[0]


# Shorthand for the current request's user id (used for created_by/updated_by
# columns and audit logging). Wraps _resolve_user.
def get_user_id(request: Request) -> int:
    return _resolve_user(request)[1]


# Guard called at the top of admin-only endpoints (the /api/admin/* routes)
# to reject non-admin users with a 403.
def _require_admin(request: Request) -> None:
    """Raises 403 if the requesting user is not an admin."""
    if _SKIP_AUTH:
        return
    _, _, user_access = _resolve_user(request)
    if user_access != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")


# Builds a Windows-auth (Trusted_Connection) ODBC connection string for the given database
def make_conn_str(database: str) -> str:
    return f"DRIVER={{{DRIVER}}};SERVER={SERVER};DATABASE={database};Trusted_Connection=yes;"


# Creates the target database on the SQL Server instance if it doesn't already
# exist. Connects to the built-in "master" db to run the CREATE DATABASE check.
# Called once at startup by init_db().
def ensure_database():
    conn = pyodbc.connect(make_conn_str("master"), autocommit=True)
    try:
        conn.execute(
            f"IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'{DATABASE}') "
            f"CREATE DATABASE [{DATABASE}]"
        )
    finally:
        conn.close()


_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "5"))
_pool: queue.Queue = queue.Queue(maxsize=_POOL_SIZE)
_pool_lock = threading.Lock()

def _make_connection() -> pyodbc.Connection:
    conn = pyodbc.connect(make_conn_str(DATABASE))
    conn.autocommit = False
    return conn

def _acquire_connection() -> pyodbc.Connection:
    try:
        conn = _pool.get_nowait()
        try:
            conn.execute("SELECT 1")
            return conn
        except Exception:
            try: conn.close()
            except Exception: pass
    except queue.Empty:
        pass
    return _make_connection()

def _release_connection(conn: pyodbc.Connection) -> None:
    try:
        if not _pool.full():
            _pool.put_nowait(conn)
            return
    except queue.Full:
        pass
    try: conn.close()
    except Exception: pass

# Context manager giving every endpoint a transactional DB connection: commits
# on success, rolls back on any exception, returns connection to pool. Used with
# "with get_db() as conn:" throughout the endpoints below.
@contextmanager
def get_db():
    conn = _acquire_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        try: conn.rollback()
        except Exception: pass
        raise
    finally:
        _release_connection(conn)


# Converts a pyodbc cursor's remaining rows into a list of dicts (column name
# -> value), stringifying date/datetime values via isoformat() for JSON output
def rows_as_dicts(cursor) -> list:
    cols = [d[0] for d in cursor.description]
    result = []
    for row in cursor.fetchall():
        d = {}
        for col, val in zip(cols, row):
            d[col] = val.isoformat() if hasattr(val, "isoformat") else val
        result.append(d)
    return result


# Same as rows_as_dicts but for a single row (fetchone); returns None if no row matched
def row_as_dict(cursor) -> Optional[dict]:
    cols = [d[0] for d in cursor.description]
    row = cursor.fetchone()
    if row is None:
        return None
    d = {}
    for col, val in zip(cols, row):
        d[col] = val.isoformat() if hasattr(val, "isoformat") else val
    return d


# Normalizes a value for storage as text in the audit_trail's old_value/new_value
# columns: None -> "NULL", dict/list -> JSON string, everything else -> str()
def stringify(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    return str(val)


# Writes one row to audit_trail recording a change (create/update) to a session
# row. Called from create_session, update_row (and indirectly wherever row data
# changes) so admins can review history via admin_list_audit. Never raises -
# a failed audit write should not block the actual data change.
# Runs the same parameterized INSERT/UPDATE statement for many rows at once via
# pyodbc's fast_executemany, instead of one execute() call per row. A plain Python
# loop of individual execute() calls means one network round-trip to SQL Server per
# row — fine for a handful of rows, but a real bottleneck once files reach the
# thousands of rows (a 5,000-row upload would otherwise be 5,000 sequential round-trips).
# Chunked at 1000 rows per batch as a safety margin against driver/statement limits.
def _executemany_batched(conn, sql: str, params_list: list, batch_size: int = 1000) -> None:
    cursor = conn.cursor()
    cursor.fast_executemany = True
    for i in range(0, len(params_list), batch_size):
        cursor.executemany(sql, params_list[i:i + batch_size])


def add_audit_log(conn, session_id: int, row_id: Optional[int], field_name: Optional[str],
                  old_val: Any, new_val: Any, change_type: str, org_id: int = 1, user_id: int = 1):
    try:
        conn.execute(
            "INSERT INTO audit_trail "
            "(session_id, row_id, field_name, old_value, new_value, change_type, organisation_id, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, row_id, field_name, stringify(old_val), stringify(new_val), change_type, org_id, user_id)
        )
    except Exception as e:
        print(f"Audit log failed: {e}")


# Creates the database and all tables/indexes if they don't already exist
# (idempotent - safe to run on every startup), and applies small schema
# migrations (new columns) to older databases. Called once below, at import time.
def init_db():
    ensure_database()
    with get_db() as conn:

        # --- Phase 1: organisations & users ---
        # organisations: top-level tenant. Every other table scopes its rows
        # to one organisation_id, so different customers' data stays isolated.
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='organisations' AND xtype='U')
            CREATE TABLE organisations (
                organisation_id INT IDENTITY(1,1) PRIMARY KEY,
                name NVARCHAR(255) NOT NULL,
                organisation_type_ref NVARCHAR(100),
                default_country_ref NVARCHAR(100),
                default_currency_ref NVARCHAR(10),
                disabled BIT DEFAULT 0,
                created DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INT,
                updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_by INT
            )
        """)
        # users: one row per login identity, belongs to exactly one organisation.
        # email is matched against the Auth0 JWT in _resolve_user; user_access
        # ('admin' vs other) gates the /api/admin/* endpoints via _require_admin.
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
            CREATE TABLE users (
                user_id INT IDENTITY(1,1) PRIMARY KEY,
                organisation_id INT NOT NULL REFERENCES organisations(organisation_id),
                alias NVARCHAR(100),
                user_type NVARCHAR(50),
                title NVARCHAR(50),
                forename NVARCHAR(100),
                surname NVARCHAR(100),
                display_name NVARCHAR(200),
                email NVARCHAR(255),
                country_ref NVARCHAR(100),
                user_access NVARCHAR(50),
                disabled BIT DEFAULT 0,
                created DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INT,
                updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_by INT
            )
        """)

        # Seed default organisation (id=1) on a fresh DB
        conn.execute("""
            IF NOT EXISTS (SELECT 1 FROM organisations)
            INSERT INTO organisations (name, organisation_type_ref, disabled)
            VALUES (N'Default Organisation', N'wine_merchant', 0)
        """)

        # --- Core tables ---
        # sessions: one wine-data upload/onboarding batch (e.g. one file import
        # or manual-entry batch). status tracks progress ('in_progress', etc).
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sessions' AND xtype='U')
            CREATE TABLE sessions (
                id INT IDENTITY(1,1) PRIMARY KEY,
                organisation_id INT NOT NULL DEFAULT 1,
                session_type NVARCHAR(MAX) NOT NULL,
                fields NVARCHAR(MAX),
                status NVARCHAR(MAX) DEFAULT 'in_progress',
                disabled INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INT,
                updated_by INT
            )
        """)
        # session_rows: individual wine data rows belonging to a session, stored
        # as JSON (row_content) rather than fixed columns since the schema
        # varies per session_type. row_index is the row's 1-based position.
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='session_rows' AND xtype='U')
            CREATE TABLE session_rows (
                id INT IDENTITY(1,1) PRIMARY KEY,
                session_id INT NOT NULL,
                organisation_id INT NOT NULL DEFAULT 1,
                row_index INT NOT NULL,
                row_content NVARCHAR(MAX) NOT NULL,
                disabled INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)
        # audit_trail: change history for session_rows (who changed what field,
        # old vs new value, create/update). Written by add_audit_log, read by
        # the admin_list_audit endpoint.
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_trail' AND xtype='U')
            CREATE TABLE audit_trail (
                id INT IDENTITY(1,1) PRIMARY KEY,
                session_id INT NOT NULL,
                organisation_id INT NOT NULL DEFAULT 1,
                row_id INT,
                field_name NVARCHAR(MAX),
                old_value NVARCHAR(MAX),
                new_value NVARCHAR(MAX),
                change_type NVARCHAR(MAX) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)
        # master_cellars: an org's reference list of known cellar names, used
        # by the frontend for validation/autocomplete during data entry.
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='master_cellars' AND xtype='U')
            CREATE TABLE master_cellars (
                id INT IDENTITY(1,1) PRIMARY KEY,
                organisation_id INT NOT NULL DEFAULT 1,
                name NVARCHAR(MAX) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INT
            )
        """)
        # master_clients: same idea as master_cellars but for known client codes
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='master_clients' AND xtype='U')
            CREATE TABLE master_clients (
                id INT IDENTITY(1,1) PRIMARY KEY,
                organisation_id INT NOT NULL DEFAULT 1,
                code NVARCHAR(MAX) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INT
            )
        """)

        # Add organisation_id to pre-existing tables (idempotent)
        for table in ("sessions", "session_rows", "audit_trail", "master_cellars", "master_clients"):
            conn.execute(
                f"IF NOT EXISTS (SELECT 1 FROM sys.columns "
                f"WHERE object_id = OBJECT_ID('{table}') AND name = 'organisation_id') "
                f"ALTER TABLE {table} ADD organisation_id INT NOT NULL DEFAULT 1"
            )

        # Add created_by / updated_by to pre-existing tables (idempotent)
        for table, col in [
            ("sessions", "created_by"), ("sessions", "updated_by"),
            ("audit_trail", "created_by"),
            ("master_cellars", "created_by"), ("master_clients", "created_by"),
        ]:
            conn.execute(
                f"IF NOT EXISTS (SELECT 1 FROM sys.columns "
                f"WHERE object_id = OBJECT_ID('{table}') AND name = '{col}') "
                f"ALTER TABLE {table} ADD {col} INT"
            )

        # --- Indexes / constraints ---
        # Prevents duplicate row_index values within the same session (data integrity)
        conn.execute("""
            IF NOT EXISTS (SELECT name FROM sys.indexes WHERE name='UQ_session_rows_session_row')
            ALTER TABLE session_rows
            ADD CONSTRAINT UQ_session_rows_session_row UNIQUE (session_id, row_index)
        """)
        conn.execute("""
            IF NOT EXISTS (SELECT name FROM sys.indexes WHERE name='IX_session_rows_session_id')
            CREATE INDEX IX_session_rows_session_id ON session_rows(session_id)
        """)
        conn.execute("""
            IF NOT EXISTS (SELECT name FROM sys.indexes WHERE name='IX_audit_trail_session_id')
            CREATE INDEX IX_audit_trail_session_id ON audit_trail(session_id)
        """)
        # regions: global (not org-scoped) wine region reference data used for
        # lookups/validation, e.g. by the frontend's region picker.
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='regions' AND xtype='U')
            CREATE TABLE regions (
                id INT IDENTITY(1,1) PRIMARY KEY,
                region_name NVARCHAR(500) NOT NULL,
                type NVARCHAR(100) NOT NULL,
                parent NVARCHAR(500),
                appellation NVARCHAR(500),
                classification NVARCHAR(500),
                designation NVARCHAR(500)
            )
        """)


# Runs schema creation/migration once at module import (server startup)
init_db()


# --- Identity ---

# GET /api/me - returns the logged-in user's profile + their organisation.
# Called by the frontend on login/app load to know who's signed in and what
# org they belong to (drives role-based UI like showing the admin panel).
@app.get("/api/me")
def get_me(request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)

    with get_db() as conn:
        cursor = conn.execute(
            "SELECT organisation_id, name FROM organisations WHERE organisation_id = ? AND disabled = 0",
            (org_id,)
        )
        org = row_as_dict(cursor)
        if not org:
            raise HTTPException(status_code=403, detail="Access denied.")

        cursor = conn.execute(
            "SELECT user_id, display_name, forename, surname, email, user_access, organisation_id "
            "FROM users WHERE user_id = ? AND disabled = 0",
            (user_id,)
        )
        user = row_as_dict(cursor)
        if not user:
            raise HTTPException(status_code=403, detail="Access denied.")

        # Defense in depth: org_id/user_id both come from the same _resolve_user
        # lookup so this should never trigger, but guards against future misuse
        if user["organisation_id"] != org_id:
            raise HTTPException(status_code=403, detail="Access denied.")

        return {
            "user_id": user["user_id"],
            "display_name": user["display_name"],
            "forename": user["forename"],
            "surname": user["surname"],
            "email": user["email"],
            "user_access": user["user_access"],
            "organisation_id": org["organisation_id"],
            "organisation_name": org["name"],
        }


# --- Admin ---
# All routes below require an admin user (enforced via _require_admin) and
# back the admin panel UI (e.g. AdminPanel.tsx's organisations/users/sessions/
# audit tabs) for managing data across every organisation.

# GET /api/admin/organisations - lists every organisation (admin org-management tab)
@app.get("/api/admin/organisations")
def admin_list_orgs(request: Request):
    _require_admin(request)
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM organisations ORDER BY organisation_id")
        return rows_as_dicts(cursor)


# POST /api/admin/organisations - creates a new organisation
@app.post("/api/admin/organisations")
async def admin_create_org(request: Request):
    _require_admin(request)
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO organisations (name, organisation_type_ref, default_country_ref, default_currency_ref) "
            "VALUES (?, ?, ?, ?)",
            (body.get("name"), body.get("organisation_type_ref") or None,
             body.get("default_country_ref") or None, body.get("default_currency_ref") or None)
        )
    return {"success": True}


# PUT /api/admin/organisations/{org_id} - edits an existing organisation's details
@app.put("/api/admin/organisations/{org_id}")
async def admin_update_org(org_id: int, request: Request):
    _require_admin(request)
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET name=?, organisation_type_ref=?, default_country_ref=?, "
            "default_currency_ref=?, updated=CURRENT_TIMESTAMP WHERE organisation_id=?",
            (body.get("name"), body.get("organisation_type_ref") or None,
             body.get("default_country_ref") or None, body.get("default_currency_ref") or None, org_id)
        )
    return {"success": True}


# POST /api/admin/organisations/{org_id}/disable - soft-disables an org (org
# stays in DB but is excluded via "disabled = 0" checks, e.g. in get_me)
@app.post("/api/admin/organisations/{org_id}/disable")
def admin_disable_org(org_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=1, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


# POST /api/admin/organisations/{org_id}/enable - re-enables a disabled org
@app.post("/api/admin/organisations/{org_id}/enable")
def admin_enable_org(org_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=0, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


# GET /api/admin/users - lists all users across all orgs, with org name joined
# in for display (admin panel's user-management tab)
@app.get("/api/admin/users")
def admin_list_users(request: Request):
    _require_admin(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT u.*, o.name AS organisation_name "
            "FROM users u LEFT JOIN organisations o ON u.organisation_id = o.organisation_id "
            "ORDER BY u.user_id"
        )
        return rows_as_dicts(cursor)


# POST /api/admin/users - creates a user record and, if Auth0 management
# credentials are configured, also provisions the user in Auth0 and returns a
# password-setup URL (via _provision_auth0_user) so they can log in.
_VALID_ACCESS_LEVELS = {"user", "admin"}

@app.post("/api/admin/users")
async def admin_create_user(request: Request):
    _require_admin(request)
    body = await request.json()
    email = body.get("email") or None
    if body.get("user_access", "user") not in _VALID_ACCESS_LEVELS:
        raise HTTPException(status_code=400, detail=f"Invalid user_access. Must be one of: {', '.join(_VALID_ACCESS_LEVELS)}")
    setup_url = None
    auth0_error = None
    if email and _AUTH0_MGMT_CLIENT_ID:
        try:
            setup_url = _provision_auth0_user(email)
        except HTTPException as exc:
            auth0_error = exc.detail
        except Exception as exc:
            auth0_error = str(exc)
    # Local user row is created even if Auth0 provisioning failed, so the
    # admin can retry provisioning later without recreating the user
    with get_db() as conn:
        conn.execute(
            "INSERT INTO users (organisation_id, forename, surname, display_name, alias, email, user_access, user_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (body.get("organisation_id"), body.get("forename") or None, body.get("surname") or None,
             body.get("display_name") or None, body.get("alias") or None, email,
             body.get("user_access", "user"), body.get("user_type") or None)
        )
    return {"success": True, "setup_url": setup_url, "auth0_error": auth0_error}


# PUT /api/admin/users/{user_id} - edits a user's details (name, org, access level, etc)
@app.put("/api/admin/users/{user_id}")
async def admin_update_user(user_id: int, request: Request):
    _require_admin(request)
    body = await request.json()
    if body.get("user_access") and body.get("user_access") not in _VALID_ACCESS_LEVELS:
        raise HTTPException(status_code=400, detail=f"Invalid user_access. Must be one of: {', '.join(_VALID_ACCESS_LEVELS)}")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET organisation_id=?, forename=?, surname=?, display_name=?, alias=?, email=?, "
            "user_access=?, updated=CURRENT_TIMESTAMP WHERE user_id=?",
            (body.get("organisation_id"), body.get("forename") or None, body.get("surname") or None,
             body.get("display_name") or None, body.get("alias") or None, body.get("email") or None,
             body.get("user_access"), user_id)
        )
    return {"success": True}


# POST /api/admin/users/{user_id}/disable - soft-disables a user (they can no
# longer be resolved by _resolve_user's "disabled = 0" filter, so they lose access)
@app.post("/api/admin/users/{user_id}/disable")
def admin_disable_user(user_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET disabled=1, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,)
        )
    return {"success": True}


# POST /api/admin/users/{user_id}/enable - re-enables a disabled user
@app.post("/api/admin/users/{user_id}/enable")
def admin_enable_user(user_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET disabled=0, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,)
        )
    return {"success": True}


# GET /api/admin/sessions - lists all onboarding sessions across every org,
# with row counts and creator name, for the admin panel's sessions overview
@app.get("/api/admin/sessions")
def admin_list_sessions(request: Request):
    _require_admin(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT s.id, s.organisation_id, o.name AS organisation_name, s.session_type, s.status, "
            "s.created_at, s.updated_at, "
            "(SELECT COUNT(*) FROM session_rows sr WHERE sr.session_id = s.id) AS total_rows, "
            "u.display_name AS created_by_name "
            "FROM sessions s "
            "LEFT JOIN organisations o ON s.organisation_id = o.organisation_id "
            "LEFT JOIN users u ON s.created_by = u.user_id "
            "WHERE s.disabled = 0 "
            "ORDER BY s.created_at DESC"
        )
        return rows_as_dicts(cursor)


# GET /api/admin/audit - lists the 500 most recent audit_trail entries (who
# changed what, when) across all orgs, for the admin panel's audit log tab
@app.get("/api/admin/audit")
def admin_list_audit(request: Request):
    _require_admin(request)
    with get_db() as conn:
        # TOP 500 caps result size since audit_trail can grow unbounded over time
        cursor = conn.execute(
            "SELECT TOP 500 a.id, a.session_id, a.field_name, a.old_value, a.new_value, "
            "a.change_type, a.created_at, "
            "o.name AS organisation_name, "
            "u.display_name AS created_by_name "
            "FROM audit_trail a "
            "LEFT JOIN organisations o ON a.organisation_id = o.organisation_id "
            "LEFT JOIN users u ON a.created_by = u.user_id "
            "ORDER BY a.created_at DESC"
        )
        return rows_as_dicts(cursor)


# --- Sessions ---
# A "session" is one data-onboarding batch (an upload or manual-entry run).
# All routes here are scoped to the caller's own organisation via get_org_id.

# GET /api/sessions - lists the current org's non-disabled sessions, newest
# first (e.g. the sessions/history list page)
@app.get("/api/sessions")
def list_sessions(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT * FROM sessions WHERE disabled = 0 AND organisation_id = ? ORDER BY created_at DESC",
            (org_id,)
        )
        return rows_as_dicts(cursor)


# POST /api/sessions - creates a new session plus its initial rows in one go
# (called when the frontend starts a new upload/manual-entry batch, e.g. from
# the file upload or manual entry grid screens). Rows are inserted in batches
# (see _executemany_batched) rather than one at a time, since a naive per-row
# INSERT loop turns a several-thousand-row upload into several thousand
# sequential DB round-trips. One summary audit entry is logged for the whole
# batch instead of one per row, for the same reason.
@app.post("/api/sessions")
async def create_session(request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    session_type = body.get("sessionType")
    rows = body.get("rows", [])
    fields = body.get("fields", {})
    status = body.get("status", "in_progress")

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO sessions (session_type, fields, status, organisation_id, created_by, updated_by) "
            "OUTPUT INSERTED.id VALUES (?, ?, ?, ?, ?, ?)",
            (session_type, json.dumps(fields), status, org_id, user_id, user_id)
        )
        session_id = cursor.fetchone()[0]

        # row_index is 1-based (matches the UNIQUE constraint on session_rows);
        # each row's full content is stored as JSON since columns vary by session_type
        if rows:
            _executemany_batched(
                conn,
                "INSERT INTO session_rows (session_id, row_index, row_content, organisation_id) VALUES (?, ?, ?, ?)",
                [(session_id, i + 1, json.dumps(row_data), org_id) for i, row_data in enumerate(rows)]
            )
            add_audit_log(conn, session_id, None, None, None, f"{len(rows)} rows", "CREATE", org_id, user_id)

        return {"id": session_id}


# PATCH /api/sessions/{session_id} - partially updates a session's status/
# fields/disabled flag (e.g. marking a session complete, or soft-deleting it
# via disabled). Only the fields present in the request body are updated.
@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: int, request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    status = body.get("status")
    fields = body.get("fields")
    disabled = body.get("disabled")

    # Build the SET clause dynamically so only fields actually sent get updated
    updates = []
    params = []

    if status is not None:
        updates.append("status = ?")
        params.append(status)
    if fields is not None:
        updates.append("fields = ?")
        params.append(json.dumps(fields))
    if disabled is not None:
        updates.append("disabled = ?")
        params.append(disabled)

    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        updates.append("updated_by = ?")
        params.append(user_id)
        query = f"UPDATE sessions SET {', '.join(updates)} WHERE id = ? AND organisation_id = ?"
        params.extend([session_id, org_id])
        with get_db() as conn:
            conn.execute(query, tuple(params))

    return {"success": True}


# GET /api/sessions/{session_id} - fetches one session plus all its rows,
# used when opening a session for review/editing in the data grid
@app.get("/api/sessions/{session_id}")
def get_session(session_id: int, request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        # organisation_id filter here (and below) prevents one org from
        # reading another org's session by guessing/incrementing the id
        cursor = conn.execute(
            "SELECT * FROM sessions WHERE id = ? AND organisation_id = ?",
            (session_id, org_id)
        )
        session = row_as_dict(cursor)
        if not session:
            raise HTTPException(status_code=404, detail="Not found")

        cursor = conn.execute(
            "SELECT * FROM session_rows WHERE session_id = ? AND organisation_id = ? ORDER BY row_index ASC",
            (session_id, org_id)
        )
        db_rows = rows_as_dicts(cursor)

        # Unpack each row's JSON content and re-attach DB metadata (0-based
        # "id" for frontend grid indexing, plus db_id/updated_at)
        result_rows = []
        for r in db_rows:
            content = json.loads(r["row_content"])
            content["id"] = r["row_index"] - 1
            content["db_id"] = r["id"]
            content["updated_at"] = r["updated_at"]
            result_rows.append(content)

        session["rows"] = result_rows
        return session


# PATCH /api/sessions/{session_id}/rows/{row_index} - updates a single row's
# content (e.g. inline cell edits in the data grid) and audit-logs which
# fields changed
@app.patch("/api/sessions/{session_id}/rows/{row_index}")
async def update_row(session_id: int, row_index: int, request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    content = body.get("content")

    with get_db() as conn:
        cursor = conn.execute(
            "SELECT id, row_content FROM session_rows "
            "WHERE session_id = ? AND row_index = ? AND organisation_id = ?",
            (session_id, row_index, org_id)
        )
        row = row_as_dict(cursor)
        if not row:
            raise HTTPException(status_code=404, detail="Row not found")

        old_content = json.loads(row["row_content"])
        # These are frontend-only/derived fields, not real data - skip auditing them
        excluded = {"manualEdits", "errors", "isDuplicate", "id", "db_id", "updated_at", "originalIndex", "status"}

        # Only log fields that actually changed, to keep audit_trail meaningful
        for key, val in content.items():
            if key not in excluded and val != old_content.get(key):
                add_audit_log(conn, session_id, row["id"], key, old_content.get(key), val, "UPDATE", org_id, user_id)

        conn.execute(
            "UPDATE session_rows SET row_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(content), row["id"])
        )
        conn.execute(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ? AND organisation_id = ?",
            (user_id, session_id, org_id)
        )
        return {"success": True}


# POST /api/sessions/{session_id}/rows/bulk - updates many rows at once, batched via
# _executemany_batched (see above) rather than one UPDATE per row, and without
# per-field audit logging (used for bulk operations like the upload corrections
# workflow or AI/normalization passes, where per-cell audit entries would be noisy)
@app.post("/api/sessions/{session_id}/rows/bulk")
async def bulk_update_rows(session_id: int, request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    rows = body.get("rows", [])

    with get_db() as conn:
        if rows:
            # rowIndex from the frontend is 0-based; DB row_index is 1-based.
            # Accept either key: "content" from normal edits, "normalized_json"
            # from the corrections/normalization workflow
            _executemany_batched(
                conn,
                "UPDATE session_rows SET row_content = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE session_id = ? AND row_index = ? AND organisation_id = ?",
                [
                    (json.dumps(row.get("content") or row.get("normalized_json")), session_id, (row.get("rowIndex") or 0) + 1, org_id)
                    for row in rows
                ]
            )
        conn.execute(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ? AND organisation_id = ?",
            (user_id, session_id, org_id)
        )
    return {"success": True}


# DELETE /api/sessions/{session_id} - permanently deletes a session; its
# session_rows and audit_trail entries cascade-delete via the FK ON DELETE CASCADE
@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE id = ? AND organisation_id = ?",
            (session_id, org_id)
        )
    return {"success": True}


# --- Master Data ---
# Org-scoped reference lists (cellar names, client codes) used by the frontend
# for validation/autocomplete during data entry, plus global region lookups.

# GET /api/master/cellars - returns the org's known cellar names as a flat
# list of strings (e.g. for a validation/autocomplete dropdown)
@app.get("/api/master/cellars")
def get_master_cellars(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT name FROM master_cellars WHERE organisation_id = ? ORDER BY name",
            (org_id,)
        )
        return [row[0] for row in cursor.fetchall()]


# POST /api/master/cellars - replaces the org's entire cellar name list with
# the given names (full overwrite, not merge - simplest way to sync from the UI)
@app.post("/api/master/cellars")
async def save_master_cellars(request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    names = body.get("names", [])
    with get_db() as conn:
        conn.execute("DELETE FROM master_cellars WHERE organisation_id = ?", (org_id,))
        if names:
            _executemany_batched(
                conn,
                "INSERT INTO master_cellars (name, organisation_id, created_by) VALUES (?, ?, ?)",
                [(name, org_id, user_id) for name in names],
            )
    return {"success": True}


# GET /api/master/clients - same as get_master_cellars but for client codes
@app.get("/api/master/clients")
def get_master_clients(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT code FROM master_clients WHERE organisation_id = ? ORDER BY code",
            (org_id,)
        )
        return [row[0] for row in cursor.fetchall()]


# POST /api/master/clients - full-overwrite save of the org's client code list
# (same replace-all pattern as save_master_cellars)
@app.post("/api/master/clients")
async def save_master_clients(request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    codes = body.get("codes", [])
    with get_db() as conn:
        conn.execute("DELETE FROM master_clients WHERE organisation_id = ?", (org_id,))
        if codes:
            _executemany_batched(
                conn,
                "INSERT INTO master_clients (code, organisation_id, created_by) VALUES (?, ?, ?)",
                [(code, org_id, user_id) for code in codes],
            )
    return {"success": True}


# GET /api/master/regions - returns all wine regions (global, not org-scoped)
# with display-friendly capitalized keys, for the frontend's region lookup/picker
@app.get("/api/master/regions")
def get_regions(request: Request):
    get_org_id(request)  # require a valid token; region data is not sensitive but endpoints should not be open
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT region_name, type, parent, appellation, classification, designation FROM regions ORDER BY region_name"
        )
        cols = ["Region", "Type", "Parent", "Appellation", "Classification", "Designation"]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=3000, reload=True)
