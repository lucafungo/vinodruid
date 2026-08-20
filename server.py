import os
import json
from contextlib import contextmanager
from typing import Any, Optional

import pyodbc
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

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


def get_org_id(request: Request) -> int:
    # Phase 1: reads DEV_ORG_ID from env. Phase 2: replaced with JWT extraction.
    return int(os.getenv("DEV_ORG_ID", "1"))


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
                  old_val: Any, new_val: Any, change_type: str, org_id: int = 1):
    try:
        conn.execute(
            "INSERT INTO audit_trail "
            "(session_id, row_id, field_name, old_value, new_value, change_type, organisation_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (session_id, row_id, field_name, stringify(old_val), stringify(new_val), change_type, org_id)
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

        # Seed default organisation — only runs on a fresh DB
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
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='master_cellars' AND xtype='U')
            CREATE TABLE master_cellars (
                id INT IDENTITY(1,1) PRIMARY KEY,
                organisation_id INT NOT NULL DEFAULT 1,
                name NVARCHAR(MAX) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='master_clients' AND xtype='U')
            CREATE TABLE master_clients (
                id INT IDENTITY(1,1) PRIMARY KEY,
                organisation_id INT NOT NULL DEFAULT 1,
                code NVARCHAR(MAX) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Add organisation_id to pre-existing tables (idempotent — no-op if column already exists)
        for table in ("sessions", "session_rows", "audit_trail", "master_cellars", "master_clients"):
            conn.execute(
                f"IF NOT EXISTS (SELECT 1 FROM sys.columns "
                f"WHERE object_id = OBJECT_ID('{table}') AND name = 'organisation_id') "
                f"ALTER TABLE {table} ADD organisation_id INT NOT NULL DEFAULT 1"
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
    body = await request.json()
    session_type = body.get("sessionType")
    rows = body.get("rows", [])
    fields = body.get("fields", {})
    status = body.get("status", "in_progress")

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO sessions (session_type, fields, status, organisation_id) "
            "OUTPUT INSERTED.id VALUES (?, ?, ?, ?)",
            (session_type, json.dumps(fields), status, org_id)
        )
        session_id = cursor.fetchone()[0]

        for i, row_data in enumerate(rows):
            row_cursor = conn.execute(
                "INSERT INTO session_rows (session_id, row_index, row_content, organisation_id) "
                "OUTPUT INSERTED.id VALUES (?, ?, ?, ?)",
                (session_id, i + 1, json.dumps(row_data), org_id)
            )
            row_id = row_cursor.fetchone()[0]
            add_audit_log(conn, session_id, row_id, None, None, row_data, "CREATE", org_id)

        return {"id": session_id}


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: int, request: Request):
    org_id = get_org_id(request)
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
                add_audit_log(conn, session_id, row["id"], key, old_content.get(key), val, "UPDATE", org_id)

        conn.execute(
            "UPDATE session_rows SET row_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(content), row["id"])
        )
        conn.execute(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organisation_id = ?",
            (session_id, org_id)
        )
        return {"success": True}


@app.post("/api/sessions/{session_id}/rows/bulk")
async def bulk_update_rows(session_id: int, request: Request):
    org_id = get_org_id(request)
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
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organisation_id = ?",
            (session_id, org_id)
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
    body = await request.json()
    names = body.get("names", [])
    with get_db() as conn:
        conn.execute("DELETE FROM master_cellars WHERE organisation_id = ?", (org_id,))
        for name in names:
            conn.execute(
                "INSERT INTO master_cellars (name, organisation_id) VALUES (?, ?)",
                (name, org_id)
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
    body = await request.json()
    codes = body.get("codes", [])
    with get_db() as conn:
        conn.execute("DELETE FROM master_clients WHERE organisation_id = ?", (org_id,))
        for code in codes:
            conn.execute(
                "INSERT INTO master_clients (code, organisation_id) VALUES (?, ?)",
                (code, org_id)
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
