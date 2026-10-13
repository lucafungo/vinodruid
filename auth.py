"""
Auth layer: Auth0 JWT verification, JWKS caching, Management API provisioning,
and the request-scoped helpers (get_org_id, get_user_id, _require_admin) that
every route uses to identify and authorise the caller.
"""
import json
import os
import ssl
import time
import urllib.request as _urllib

from dotenv import load_dotenv
from fastapi import HTTPException, Request
from jose import jwt as _jwt

from db import get_db, row_as_dict

load_dotenv(override=True)

_AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "")
_AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")
_SKIP_AUTH = os.getenv("SKIP_AUTH", "false").lower() == "true"

# Guard: SKIP_AUTH must never reach production
if _SKIP_AUTH and os.getenv("ENVIRONMENT", "development").lower() == "production":
    raise RuntimeError("SKIP_AUTH=true is not allowed in production.")

_AUTH0_MGMT_CLIENT_ID = os.getenv("AUTH0_MGMT_CLIENT_ID", "")
_AUTH0_MGMT_CLIENT_SECRET = os.getenv("AUTH0_MGMT_CLIENT_SECRET", "")

_jwks_cache: dict = {}
_jwks_cache_time: float = 0.0
_JWKS_TTL_SECONDS = 86400  # refresh Auth0 public keys every 24 hours

_mgmt_token_cache: dict = {}


def _get_jwks() -> dict:
    global _jwks_cache, _jwks_cache_time
    stale = time.time() - _jwks_cache_time > _JWKS_TTL_SECONDS
    if (not _jwks_cache or stale) and _AUTH0_DOMAIN:
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
            url = f"https://{_AUTH0_DOMAIN}/.well-known/jwks.json"
            with _urllib.urlopen(url, timeout=10, context=ctx) as resp:
                _jwks_cache = json.loads(resp.read())
                _jwks_cache_time = time.time()
        except Exception as exc:
            if _jwks_cache:
                pass  # serve stale cache rather than breaking all auth
            else:
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


def _get_mgmt_token() -> str:
    global _mgmt_token_cache
    import certifi, urllib.parse
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
    _mgmt_token_cache = {
        "token": data["access_token"],
        "expires_at": time.time() + data.get("expires_in", 86400),
    }
    return _mgmt_token_cache["token"]


def _provision_auth0_user(email: str) -> str:
    """Create a new Auth0 user and return a 7-day password-setup URL."""
    import certifi, secrets, urllib.error
    token = _get_mgmt_token()
    ctx = ssl.create_default_context(cafile=certifi.where())

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


def _resolve_user(request: Request) -> tuple:
    """Return (org_id, user_id, user_access). Result cached on request.state to avoid repeat DB lookups."""
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


def get_org_id(request: Request) -> int:
    return _resolve_user(request)[0]


def get_user_id(request: Request) -> int:
    return _resolve_user(request)[1]


def _require_admin(request: Request) -> None:
    if _SKIP_AUTH:
        return
    _, _, user_access = _resolve_user(request)
    if user_access != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
