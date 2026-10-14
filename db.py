"""
Database layer: connection pool, context manager, helper functions,
schema creation/migration (init_db). Every module that needs DB access
imports get_db from here; nothing else should touch pyodbc directly.
"""
import json
import os
import queue
import threading
from contextlib import contextmanager
from typing import Any, Optional

import pyodbc
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv(override=True)

SERVER = os.getenv("SQL_SERVER", r"WOLUCA\SQLEXPRESS")
DATABASE = os.getenv("SQL_DATABASE", "WineOnboarding")
DRIVER = os.getenv("SQL_DRIVER", "ODBC Driver 17 for SQL Server")
_SQL_USER = os.getenv("SQL_USER", "")
_SQL_PASSWORD = os.getenv("SQL_PASSWORD", "")


def make_conn_str(database: str) -> str:
    if _SQL_USER and _SQL_PASSWORD:
        # Azure SQL: use SQL username/password auth
        return (
            f"DRIVER={{{DRIVER}}};SERVER={SERVER};DATABASE={database};"
            f"UID={_SQL_USER};PWD={_SQL_PASSWORD};"
            "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"
        )
    # Local dev: Windows Integrated Auth (domain-joined machine only)
    return f"DRIVER={{{DRIVER}}};SERVER={SERVER};DATABASE={database};Trusted_Connection=yes;"


def ensure_database():
    # Azure SQL: the database is created in the portal — skip this.
    # Local dev only: creates the database on SQL Server Express if missing.
    if _SQL_USER:
        return
    conn = pyodbc.connect(make_conn_str("master"), autocommit=True)
    try:
        conn.execute(
            f"IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'{DATABASE}') "
            f"CREATE DATABASE [{DATABASE}]"
        )
    finally:
        conn.close()


# --- Connection pool ---

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
            try:
                conn.close()
            except Exception:
                pass
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
    try:
        conn.close()
    except Exception:
        pass


@contextmanager
def get_db():
    """Transactional DB connection: commits on success, rolls back on exception, returns to pool."""
    conn = _acquire_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        _release_connection(conn)


# --- Row helpers ---

def rows_as_dicts(cursor) -> list:
    """Convert all remaining cursor rows to dicts, serialising date/datetime via isoformat."""
    cols = [d[0] for d in cursor.description]
    result = []
    for row in cursor.fetchall():
        d = {}
        for col, val in zip(cols, row):
            d[col] = val.isoformat() if hasattr(val, "isoformat") else val
        result.append(d)
    return result


def row_as_dict(cursor) -> Optional[dict]:
    """Like rows_as_dicts but for a single row; returns None if no row matched."""
    cols = [d[0] for d in cursor.description]
    row = cursor.fetchone()
    if row is None:
        return None
    d = {}
    for col, val in zip(cols, row):
        d[col] = val.isoformat() if hasattr(val, "isoformat") else val
    return d


def stringify(val: Any) -> str:
    """Normalise a value for audit_trail old_value/new_value columns."""
    if val is None:
        return "NULL"
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    return str(val)


def _executemany_batched(conn, sql: str, params_list: list, batch_size: int = 1000) -> None:
    """Run a parameterised statement for many rows at once using fast_executemany, chunked at batch_size."""
    cursor = conn.cursor()
    cursor.fast_executemany = True
    for i in range(0, len(params_list), batch_size):
        cursor.executemany(sql, params_list[i:i + batch_size])


def add_audit_log(conn, session_id: int, row_id: Optional[int], field_name: Optional[str],
                  old_val: Any, new_val: Any, change_type: str, org_id: int = 1, user_id: int = 1):
    """Write one audit_trail row. Never raises — a failed write must not block the real operation."""
    try:
        conn.execute(
            "INSERT INTO audit_trail "
            "(session_id, row_id, field_name, old_value, new_value, change_type, organisation_id, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, row_id, field_name, stringify(old_val), stringify(new_val), change_type, org_id, user_id)
        )
    except Exception as e:
        print(f"Audit log failed: {e}")


# --- Schema creation / migration ---

def init_db():
    """Create all tables and apply idempotent migrations. Called once at startup."""
    ensure_database()
    with get_db() as conn:

        # organisations: top-level tenant — every per-org table has an organisation_id FK
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
        # users: one row per login identity, mapped from Auth0 email claim
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

        conn.execute("""
            IF NOT EXISTS (SELECT 1 FROM organisations)
            INSERT INTO organisations (name, organisation_type_ref, disabled)
            VALUES (N'Default Organisation', N'wine_merchant', 0)
        """)

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

        # Idempotent column additions for databases created before these columns existed
        for table in ("sessions", "session_rows", "audit_trail", "master_cellars", "master_clients"):
            conn.execute(
                f"IF NOT EXISTS (SELECT 1 FROM sys.columns "
                f"WHERE object_id = OBJECT_ID('{table}') AND name = 'organisation_id') "
                f"ALTER TABLE {table} ADD organisation_id INT NOT NULL DEFAULT 1"
            )
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

        # Indexes and unique constraints
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
