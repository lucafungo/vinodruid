import os
import json
import ssl
import urllib.request as _urllib
from contextlib import contextmanager
from typing import Any, Optional

import pyodbc
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt as _jwt


load_dotenv(override=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVER = os.getenv("SQL_SERVER", r"WOLUCA\SQLEXPRESS")
DATABASE = os.getenv("SQL_DATABASE", "WineOnboarding")
DRIVER = os.getenv("SQL_DRIVER", "ODBC Driver 17 for SQL Server")


_AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "")
_AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")
_SKIP_AUTH = os.getenv("SKIP_AUTH", "false").lower() == "true"
_jwks_cache: dict = {}


def _get_jwks() -> dict:
    global _jwks_cache
    if not _jwks_cache and _AUTH0_DOMAIN:
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
            with _urllib.urlopen(f"https://{_AUTH0_DOMAIN}/.well-known/jwks.json", timeout=10, context=ctx) as resp:
                _jwks_cache = json.loads(resp.read())
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Could not reach Auth0 JWKS endpoint: {exc}")
    return _jwks_cache


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
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")), None)
    if not key:
        raise HTTPException(status_code=401, detail="Signing key not found.")
    rsa_key = {k: key[k] for k in ("kty", "kid", "use", "n", "e") if k in key}
    try:
        return _jwt.decode(token, rsa_key, algorithms=["RS256"],
                           audience=_AUTH0_AUDIENCE, issuer=f"https://{_AUTH0_DOMAIN}/")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token invalid: {exc}")


def _resolve_user(request: Request) -> tuple:
    """Returns (org_id, user_id). Caches result on request.state to avoid repeat DB lookups."""
    if hasattr(request.state, "_vd_user"):
        return request.state._vd_user

    if _SKIP_AUTH:
        result = (int(os.getenv("DEV_ORG_ID", "1")), int(os.getenv("DEV_USER_ID", "1")))
        request.state._vd_user = result
        return result

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    claims = _verify_token(auth[7:])
    email = claims.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Token does not contain email claim.")

    with get_db() as conn:
        cursor = conn.execute(
            "SELECT user_id, organisation_id FROM users WHERE email = ? AND disabled = 0", (email,)
        )
        user = row_as_dict(cursor)

    if not user:
        raise HTTPException(status_code=403, detail=f"No active user found for {email}.")

    result = (user["organisation_id"], user["user_id"])
    request.state._vd_user = result
    return result


def get_org_id(request: Request) -> int:
    return _resolve_user(request)[0]


def get_user_id(request: Request) -> int:
    return _resolve_user(request)[1]


def make_conn_str(database: str) -> str:
    return f"DRIVER={{{DRIVER}}};SERVER={SERVER};DATABASE={database};Trusted_Connection=yes;"


def ensure_database():
    conn = pyodbc.connect(make_conn_str("master"), autocommit=True)
    try:
        conn.execute(
            f"IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'{DATABASE}') "
            f"CREATE DATABASE [{DATABASE}]"
        )
    finally:
        conn.close()


@contextmanager
def get_db():
    conn = pyodbc.connect(make_conn_str(DATABASE))
    conn.autocommit = False
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def rows_as_dicts(cursor) -> list:
    cols = [d[0] for d in cursor.description]
    result = []
    for row in cursor.fetchall():
        d = {}
        for col, val in zip(cols, row):
            d[col] = val.isoformat() if hasattr(val, "isoformat") else val
        result.append(d)
    return result


def row_as_dict(cursor) -> Optional[dict]:
    cols = [d[0] for d in cursor.description]
    row = cursor.fetchone()
    if row is None:
        return None
    d = {}
    for col, val in zip(cols, row):
        d[col] = val.isoformat() if hasattr(val, "isoformat") else val
    return d


def stringify(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    return str(val)


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


def init_db():
    ensure_database()
    with get_db() as conn:

        # --- Phase 1: organisations & users ---
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
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
            CREATE TABLE users (
                user_id INT IDENTITY(1,1) PRIMARY KEY,
                organisation_id INT NOT NULL REFERENCES organisations(organisation_id),
                alias NVARCHAR(100),
                user_type NVARCHAR(50),
                password NVARCHAR(255),
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


init_db()


# --- Identity ---

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
            raise HTTPException(
                status_code=403,
                detail=f"Organisation {org_id} not found or is disabled."
            )

        cursor = conn.execute(
            "SELECT user_id, display_name, forename, surname, email, user_access, organisation_id "
            "FROM users WHERE user_id = ? AND disabled = 0",
            (user_id,)
        )
        user = row_as_dict(cursor)
        if not user:
            raise HTTPException(
                status_code=403,
                detail=f"User {user_id} not found or is disabled."
            )

        if user["organisation_id"] != org_id:
            raise HTTPException(
                status_code=403,
                detail=f"User {user_id} does not belong to organisation {org_id}."
            )

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

@app.get("/api/admin/organisations")
def admin_list_orgs():
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM organisations ORDER BY organisation_id")
        return rows_as_dicts(cursor)


@app.post("/api/admin/organisations")
async def admin_create_org(request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO organisations (name, organisation_type_ref, default_country_ref, default_currency_ref) "
            "VALUES (?, ?, ?, ?)",
            (body.get("name"), body.get("organisation_type_ref") or None,
             body.get("default_country_ref") or None, body.get("default_currency_ref") or None)
        )
    return {"success": True}


@app.put("/api/admin/organisations/{org_id}")
async def admin_update_org(org_id: int, request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET name=?, organisation_type_ref=?, default_country_ref=?, "
            "default_currency_ref=?, updated=CURRENT_TIMESTAMP WHERE organisation_id=?",
            (body.get("name"), body.get("organisation_type_ref") or None,
             body.get("default_country_ref") or None, body.get("default_currency_ref") or None, org_id)
        )
    return {"success": True}


@app.post("/api/admin/organisations/{org_id}/disable")
def admin_disable_org(org_id: int):
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=1, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


@app.post("/api/admin/organisations/{org_id}/enable")
def admin_enable_org(org_id: int):
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=0, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


@app.get("/api/admin/users")
def admin_list_users():
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT u.*, o.name AS organisation_name "
            "FROM users u LEFT JOIN organisations o ON u.organisation_id = o.organisation_id "
            "ORDER BY u.user_id"
        )
        return rows_as_dicts(cursor)


@app.post("/api/admin/users")
async def admin_create_user(request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO users (organisation_id, forename, surname, display_name, email, user_access, user_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (body.get("organisation_id"), body.get("forename") or None, body.get("surname") or None,
             body.get("display_name") or None, body.get("email") or None,
             body.get("user_access", "user"), body.get("user_type") or None)
        )
    return {"success": True}


@app.put("/api/admin/users/{user_id}")
async def admin_update_user(user_id: int, request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET organisation_id=?, forename=?, surname=?, display_name=?, email=?, "
            "user_access=?, updated=CURRENT_TIMESTAMP WHERE user_id=?",
            (body.get("organisation_id"), body.get("forename") or None, body.get("surname") or None,
             body.get("display_name") or None, body.get("email") or None,
             body.get("user_access"), user_id)
        )
    return {"success": True}


@app.post("/api/admin/users/{user_id}/disable")
def admin_disable_user(user_id: int):
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET disabled=1, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,)
        )
    return {"success": True}


@app.post("/api/admin/users/{user_id}/enable")
def admin_enable_user(user_id: int):
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET disabled=0, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,)
        )
    return {"success": True}


@app.get("/api/admin/sessions")
def admin_list_sessions():
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


@app.get("/api/admin/audit")
def admin_list_audit():
    with get_db() as conn:
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


# --- Admin ---

@app.get("/api/admin/organisations")
def admin_list_orgs():
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM organisations ORDER BY organisation_id")
        return rows_as_dicts(cursor)


@app.post("/api/admin/organisations")
async def admin_create_org(request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO organisations (name, organisation_type_ref, default_country_ref, default_currency_ref) "
            "VALUES (?, ?, ?, ?)",
            (body.get("name"), body.get("organisation_type_ref") or None,
             body.get("default_country_ref") or None, body.get("default_currency_ref") or None)
        )
    return {"success": True}


@app.put("/api/admin/organisations/{org_id}")
async def admin_update_org(org_id: int, request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET name=?, organisation_type_ref=?, default_country_ref=?, "
            "default_currency_ref=?, updated=CURRENT_TIMESTAMP WHERE organisation_id=?",
            (body.get("name"), body.get("organisation_type_ref") or None,
             body.get("default_country_ref") or None, body.get("default_currency_ref") or None, org_id)
        )
    return {"success": True}


@app.post("/api/admin/organisations/{org_id}/disable")
def admin_disable_org(org_id: int):
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=1, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


@app.post("/api/admin/organisations/{org_id}/enable")
def admin_enable_org(org_id: int):
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=0, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


@app.get("/api/admin/users")
def admin_list_users():
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT u.*, o.name AS organisation_name "
            "FROM users u LEFT JOIN organisations o ON u.organisation_id = o.organisation_id "
            "ORDER BY u.user_id"
        )
        return rows_as_dicts(cursor)


@app.post("/api/admin/users")
async def admin_create_user(request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO users (organisation_id, forename, surname, display_name, email, user_access, user_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (body.get("organisation_id"), body.get("forename") or None, body.get("surname") or None,
             body.get("display_name") or None, body.get("email") or None,
             body.get("user_access", "user"), body.get("user_type") or None)
        )
    return {"success": True}


@app.put("/api/admin/users/{user_id}")
async def admin_update_user(user_id: int, request: Request):
    body = await request.json()
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET organisation_id=?, forename=?, surname=?, display_name=?, email=?, "
            "user_access=?, updated=CURRENT_TIMESTAMP WHERE user_id=?",
            (body.get("organisation_id"), body.get("forename") or None, body.get("surname") or None,
             body.get("display_name") or None, body.get("email") or None,
             body.get("user_access"), user_id)
        )
    return {"success": True}


@app.post("/api/admin/users/{user_id}/disable")
def admin_disable_user(user_id: int):
    with get_db() as conn:
        conn.execute("UPDATE users SET disabled=1, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,))
    return {"success": True}


@app.post("/api/admin/users/{user_id}/enable")
def admin_enable_user(user_id: int):
    with get_db() as conn:
        conn.execute("UPDATE users SET disabled=0, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,))
    return {"success": True}


@app.get("/api/admin/sessions")
def admin_list_sessions():
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT s.id, s.organisation_id, o.name AS organisation_name, s.session_type, s.status, "
            "s.created_at, s.updated_at, "
            "(SELECT COUNT(*) FROM session_rows sr WHERE sr.session_id = s.id) AS total_rows, "
            "u.display_name AS created_by_name "
            "FROM sessions s "
            "LEFT JOIN organisations o ON s.organisation_id = o.organisation_id "
            "LEFT JOIN users u ON s.created_by = u.user_id "
            "WHERE s.disabled = 0 ORDER BY s.created_at DESC"
        )
        return rows_as_dicts(cursor)


@app.get("/api/admin/audit")
def admin_list_audit():
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT TOP 500 a.id, a.session_id, a.field_name, a.old_value, a.new_value, "
            "a.change_type, a.created_at, "
            "o.name AS organisation_name, u.display_name AS created_by_name "
            "FROM audit_trail a "
            "LEFT JOIN organisations o ON a.organisation_id = o.organisation_id "
            "LEFT JOIN users u ON a.created_by = u.user_id "
            "ORDER BY a.created_at DESC"
        )
        return rows_as_dicts(cursor)


# --- Sessions ---

@app.get("/api/sessions")
def list_sessions(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT * FROM sessions WHERE disabled = 0 AND organisation_id = ? ORDER BY created_at DESC",
            (org_id,)
        )
        return rows_as_dicts(cursor)


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

        for i, row_data in enumerate(rows):
            row_cursor = conn.execute(
                "INSERT INTO session_rows (session_id, row_index, row_content, organisation_id) "
                "OUTPUT INSERTED.id VALUES (?, ?, ?, ?)",
                (session_id, i + 1, json.dumps(row_data), org_id)
            )
            row_id = row_cursor.fetchone()[0]
            add_audit_log(conn, session_id, row_id, None, None, row_data, "CREATE", org_id, user_id)

        return {"id": session_id}


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: int, request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    status = body.get("status")
    fields = body.get("fields")
    disabled = body.get("disabled")

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


@app.get("/api/sessions/{session_id}")
def get_session(session_id: int, request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
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

        result_rows = []
        for r in db_rows:
            content = json.loads(r["row_content"])
            content["id"] = r["row_index"] - 1
            content["db_id"] = r["id"]
            content["updated_at"] = r["updated_at"]
            result_rows.append(content)

        session["rows"] = result_rows
        return session


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
        excluded = {"manualEdits", "errors", "isDuplicate", "id", "db_id", "updated_at", "originalIndex", "status"}

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


@app.post("/api/sessions/{session_id}/rows/bulk")
async def bulk_update_rows(session_id: int, request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    rows = body.get("rows", [])

    with get_db() as conn:
        for row in rows:
            target_idx = (row.get("rowIndex") or 0) + 1
            content = row.get("content") or row.get("normalized_json")
            conn.execute(
                "UPDATE session_rows SET row_content = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE session_id = ? AND row_index = ? AND organisation_id = ?",
                (json.dumps(content), session_id, target_idx, org_id)
            )
        conn.execute(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ? AND organisation_id = ?",
            (user_id, session_id, org_id)
        )
    return {"success": True}


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

@app.get("/api/master/cellars")
def get_master_cellars(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT name FROM master_cellars WHERE organisation_id = ? ORDER BY name",
            (org_id,)
        )
        return [row[0] for row in cursor.fetchall()]


@app.post("/api/master/cellars")
async def save_master_cellars(request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    names = body.get("names", [])
    with get_db() as conn:
        conn.execute("DELETE FROM master_cellars WHERE organisation_id = ?", (org_id,))
        for name in names:
            conn.execute(
                "INSERT INTO master_cellars (name, organisation_id, created_by) VALUES (?, ?, ?)",
                (name, org_id, user_id)
            )
    return {"success": True}


@app.delete("/api/master/cellars")
def clear_master_cellars(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        conn.execute("DELETE FROM master_cellars WHERE organisation_id = ?", (org_id,))
    return {"success": True}


@app.get("/api/master/clients")
def get_master_clients(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT code FROM master_clients WHERE organisation_id = ? ORDER BY code",
            (org_id,)
        )
        return [row[0] for row in cursor.fetchall()]


@app.post("/api/master/clients")
async def save_master_clients(request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    codes = body.get("codes", [])
    with get_db() as conn:
        conn.execute("DELETE FROM master_clients WHERE organisation_id = ?", (org_id,))
        for code in codes:
            conn.execute(
                "INSERT INTO master_clients (code, organisation_id, created_by) VALUES (?, ?, ?)",
                (code, org_id, user_id)
            )
    return {"success": True}


@app.delete("/api/master/clients")
def clear_master_clients(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        conn.execute("DELETE FROM master_clients WHERE organisation_id = ?", (org_id,))
    return {"success": True}


@app.get("/api/master/regions")
def get_regions():
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT region_name, type, parent, appellation, classification, designation FROM regions ORDER BY region_name"
        )
        cols = ["Region", "Type", "Parent", "Appellation", "Classification", "Designation"]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]


@app.post("/api/system/ai-fix")
async def ai_fix():
    raise HTTPException(
        status_code=503,
        detail="AI data cleaning is not yet configured. Set ANTHROPIC_API_KEY to enable this feature."
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=3000, reload=True)
