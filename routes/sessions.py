"""
Session routes: CRUD for onboarding sessions and their rows.
A session is one data upload or manual-entry batch. Rows are stored as
JSON (row_content) because the schema varies per session_type.
All routes are scoped to the caller's organisation via get_org_id.
"""
import json

from fastapi import APIRouter, HTTPException, Request

from auth import get_org_id, get_user_id
from db import add_audit_log, _executemany_batched, get_db, row_as_dict, rows_as_dicts

router = APIRouter()


@router.get("/api/sessions")
def list_sessions(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT * FROM sessions WHERE disabled = 0 AND organisation_id = ? ORDER BY created_at DESC",
            (org_id,)
        )
        return rows_as_dicts(cursor)


@router.post("/api/sessions")
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

        if rows:
            _executemany_batched(
                conn,
                "INSERT INTO session_rows (session_id, row_index, row_content, organisation_id) VALUES (?, ?, ?, ?)",
                [(session_id, i + 1, json.dumps(row_data), org_id) for i, row_data in enumerate(rows)]
            )
            add_audit_log(conn, session_id, None, None, None, f"{len(rows)} rows", "CREATE", org_id, user_id)

        return {"id": session_id}


@router.patch("/api/sessions/{session_id}")
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


@router.get("/api/sessions/{session_id}")
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


@router.patch("/api/sessions/{session_id}/rows/{row_index}")
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


@router.post("/api/sessions/{session_id}/rows/bulk")
async def bulk_update_rows(session_id: int, request: Request):
    org_id = get_org_id(request)
    user_id = get_user_id(request)
    body = await request.json()
    rows = body.get("rows", [])

    with get_db() as conn:
        if rows:
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


@router.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE id = ? AND organisation_id = ?",
            (session_id, org_id)
        )
    return {"success": True}
