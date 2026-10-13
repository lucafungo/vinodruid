"""
Admin routes: /api/admin/*
All endpoints here require admin user_access (enforced by _require_admin).
They back the admin panel UI: organisations, users, sessions overview, audit log.
"""
from fastapi import APIRouter, HTTPException, Request

from auth import _provision_auth0_user, _require_admin, _AUTH0_MGMT_CLIENT_ID
from db import get_db, rows_as_dicts

router = APIRouter()

_VALID_ACCESS_LEVELS = {"user", "admin"}


@router.get("/api/admin/organisations")
def admin_list_orgs(request: Request):
    _require_admin(request)
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM organisations ORDER BY organisation_id")
        return rows_as_dicts(cursor)


@router.post("/api/admin/organisations")
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


@router.put("/api/admin/organisations/{org_id}")
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


@router.post("/api/admin/organisations/{org_id}/disable")
def admin_disable_org(org_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=1, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


@router.post("/api/admin/organisations/{org_id}/enable")
def admin_enable_org(org_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE organisations SET disabled=0, updated=CURRENT_TIMESTAMP WHERE organisation_id=?", (org_id,)
        )
    return {"success": True}


@router.get("/api/admin/users")
def admin_list_users(request: Request):
    _require_admin(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT u.*, o.name AS organisation_name "
            "FROM users u LEFT JOIN organisations o ON u.organisation_id = o.organisation_id "
            "ORDER BY u.user_id"
        )
        return rows_as_dicts(cursor)


@router.post("/api/admin/users")
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
    with get_db() as conn:
        conn.execute(
            "INSERT INTO users (organisation_id, forename, surname, display_name, alias, email, user_access, user_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (body.get("organisation_id"), body.get("forename") or None, body.get("surname") or None,
             body.get("display_name") or None, body.get("alias") or None, email,
             body.get("user_access", "user"), body.get("user_type") or None)
        )
    return {"success": True, "setup_url": setup_url, "auth0_error": auth0_error}


@router.put("/api/admin/users/{user_id}")
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


@router.post("/api/admin/users/{user_id}/disable")
def admin_disable_user(user_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET disabled=1, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,)
        )
    return {"success": True}


@router.post("/api/admin/users/{user_id}/enable")
def admin_enable_user(user_id: int, request: Request):
    _require_admin(request)
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET disabled=0, updated=CURRENT_TIMESTAMP WHERE user_id=?", (user_id,)
        )
    return {"success": True}


@router.get("/api/admin/sessions")
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


@router.get("/api/admin/audit")
def admin_list_audit(request: Request):
    _require_admin(request)
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
