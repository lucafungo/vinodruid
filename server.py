"""
Orchestrator: creates the FastAPI app, registers middleware, mounts all route
modules, and runs the DB schema migration once at startup.

Route logic lives in routes/. DB utilities in db.py. Auth in auth.py.
"""
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from db import init_db
from routes.identity import router as identity_router
from routes.sessions import router as sessions_router
from routes.admin import router as admin_router
from routes.master import router as master_router

load_dotenv(override=True)

# Disable auto-generated /docs, /redoc, /openapi.json in production —
# they expose the full API schema without requiring a token.
_is_production = os.getenv("ENVIRONMENT", "development").lower() == "production"
app = FastAPI(
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)

# CORS: locked to frontend origin(s) from CORS_ORIGINS env var.
# Never use "*" in production.
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


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["server"] = "vinoDruid"
        return response

app.add_middleware(_SecurityHeadersMiddleware)

_MAX_BODY_BYTES = int(os.getenv("MAX_BODY_MB", "50")) * 1024 * 1024

class _MaxBodySizeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            cl = request.headers.get("content-length")
            if cl and int(cl) > _MAX_BODY_BYTES:
                return StarletteResponse("Request body too large.", status_code=413)
        return await call_next(request)

app.add_middleware(_MaxBodySizeMiddleware)

# Mount all route modules
app.include_router(identity_router)
app.include_router(sessions_router)
app.include_router(admin_router)
app.include_router(master_router)

# Create tables and apply migrations once at startup
init_db()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=3000, reload=True)
