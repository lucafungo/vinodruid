"""
Master data routes: /api/master/*
Org-scoped reference lists (cellars, clients) used for autocomplete/validation,
plus the global regions lookup.
"""
from fastapi import APIRouter, Request

from auth import get_org_id, get_user_id
from db import _executemany_batched, get_db

router = APIRouter()


@router.get("/api/master/cellars")
def get_master_cellars(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT name FROM master_cellars WHERE organisation_id = ? ORDER BY name",
            (org_id,)
        )
        return [row[0] for row in cursor.fetchall()]


@router.post("/api/master/cellars")
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


@router.get("/api/master/clients")
def get_master_clients(request: Request):
    org_id = get_org_id(request)
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT code FROM master_clients WHERE organisation_id = ? ORDER BY code",
            (org_id,)
        )
        return [row[0] for row in cursor.fetchall()]


@router.post("/api/master/clients")
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


@router.get("/api/master/regions")
def get_regions(request: Request):
    get_org_id(request)  # require a valid token; not sensitive but endpoints should not be open
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT region_name, type, parent, appellation, classification, designation FROM regions ORDER BY region_name"
        )
        cols = ["Region", "Type", "Parent", "Appellation", "Classification", "Designation"]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
