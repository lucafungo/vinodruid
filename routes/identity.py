"""
Identity routes: GET /api/me, GET /api/config
"""
import os

from fastapi import APIRouter, HTTPException, Request

from auth import get_org_id, get_user_id
from db import get_db, row_as_dict

router = APIRouter()


@router.get("/api/config", include_in_schema=False)
def get_config():
    """Public endpoint: returns Auth0 config the frontend needs to initialise."""
    return {
        "auth0Domain": os.getenv("VITE_AUTH0_DOMAIN") or os.getenv("AUTH0_DOMAIN", ""),
        "auth0ClientId": os.getenv("VITE_AUTH0_CLIENT_ID", ""),
        "auth0Audience": os.getenv("VITE_AUTH0_AUDIENCE") or os.getenv("AUTH0_AUDIENCE", ""),
    }


@router.get("/api/me")
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
