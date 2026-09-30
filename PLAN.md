# vinoDruid — Project Plan

**Cadence:** 1 session/week × 4 hours  
**Stack:** React + Vite · Python FastAPI · SQL Server → Azure SQL · Auth0  
**Multi-tenancy model:** Shared DB with `organisation_id` on every per-org table  
**Regions:** Global (no org scoping)  
**Auth:** Auth0, admin-provisioned users  
**Billing:** Deferred — not in scope  

---

## Phase 0 — Complete & Test the App (5 sessions) — ✅ DONE

### Session 1 — Purchase Orders: schema & field design ✅
- PO field list agreed and implemented: PO number, supplier account code, tax status, cost price, selling price, quantities (case/total), dates (created/invoiced/delivery), payment status, invoice status, delivery status, supplier invoice ref, pre-advice ref
- `purchase_orders` added to `DataType` union and `SCHEMAS` in App.tsx
- PO tile added to home screen

### Session 2 — Purchase Orders: upload, mapping, LWIN logic ✅
- Upload → map flow wired for purchase_orders
- `requireEitherOr` applied in SchemaMapper
- LWIN post-loop validation extended to purchase_orders
- Master data validation: cellar check + account code check for PO
- Duplicate fingerprint: `[po_number, lwin7, vintage, case_size, size]`

### Session 3 — Purchase Orders: review screen, validation, edge cases ✅
- Full field-level validation for all PO fields (dates, quantities, prices, tax status)
- `handleCalculationSmartFix` extended for PO quantity/price calculations
- End-to-end test with real PO file passed
- Export confirmed; session save/resume confirmed

### Session 4 — Full regression test: all data types ✅
- All eight data types tested with Ashbourne Fine Wines demo files
- Eight Excel test files generated covering every validation rule and error scenario
- All critical bugs identified during testing were resolved

### Session 5 — Bug fixes, polish, sign-off on local version ✅
Bugs fixed:
- No-LWIN required fields corrected: code now requires Producer, Country, Region (not Wine Type) to match the documented rules in RulesModal
- Client reserves duplicate detection: rows with missing account code are no longer incorrectly flagged as duplicates
- Review Changes button no longer clears ignored duplicate and price warning decisions

Features added during testing:
- Per-row delete button in the grid (hover to reveal)
- Duplicate review queue: "Review Duplicates (N)" button steps through all flagged duplicates one by one
- Price review queue: "Review Prices (N)" button steps through all price outliers one by one
- Both queues show a progress counter and "End Review" / "X remaining" badge in the modal
- Download all completed files as a ZIP (JSZip, lazy-loaded)

App is stable and frozen. Phase 1 begins next.

---

## Phase 1 — Multi-tenant Database (3 sessions)

### Sessions 6 + 7 — Multi-tenant tables and query scoping ✅
Combined into one session. Delivered:

**New tables in `init_db()`:**
```sql
organisations (
  organisation_id INT IDENTITY PRIMARY KEY,
  name NVARCHAR(255) NOT NULL,
  organisation_type_ref NVARCHAR(100),
  default_country_ref NVARCHAR(100),
  default_currency_ref NVARCHAR(10),
  disabled BIT DEFAULT 0,
  created DATETIME, created_by INT,
  updated DATETIME, updated_by INT
)

users (
  user_id INT IDENTITY PRIMARY KEY,
  organisation_id INT NOT NULL REFERENCES organisations(organisation_id),
  alias NVARCHAR(100), user_type NVARCHAR(50), password NVARCHAR(255),
  title NVARCHAR(50), forename NVARCHAR(100), surname NVARCHAR(100),
  display_name NVARCHAR(200), email NVARCHAR(255), country_ref NVARCHAR(100),
  user_access NVARCHAR(50),  -- 'admin' | 'user'
  disabled BIT DEFAULT 0,
  created DATETIME, created_by INT,
  updated DATETIME, updated_by INT
)
```

**`organisation_id INT NOT NULL DEFAULT 1` added to:** `sessions`, `session_rows`, `audit_trail`, `master_cellars`, `master_clients`. `regions` stays global.

**`created_by INT` and `updated_by INT` added to:** `sessions` (both), `audit_trail` (created_by), `master_cellars` (created_by), `master_clients` (created_by). Populated from `DEV_USER_ID` on every INSERT and UPDATE.

- Default organisation (id=1) auto-seeded on first server start
- `get_org_id(request)` reads `DEV_ORG_ID`; `get_user_id(request)` reads `DEV_USER_ID` — Phase 2 swaps both for JWT extraction without touching endpoint code
- Every SELECT, INSERT, DELETE scoped by `organisation_id`; every INSERT/UPDATE stamps `created_by`/`updated_by`
- `GET /api/me` validates that the org exists, the user exists, and the user belongs to the org — returns 403 with a clear message on any failure
- If `/api/me` returns 403, the frontend shows a full-screen error instead of loading the app
- Header shows "Hi {forename} / {organisation name}" once identity is confirmed
- `DEV_ORG_ID=1` and `DEV_USER_ID=1` added to `.env` and `.env.example`
- `queries.sql` created with org/user management, diagnostic, isolation-test, and maintenance queries
- Existing Phase 0 data auto-assigned to org 1 via `ALTER TABLE ... ADD organisation_id INT NOT NULL DEFAULT 1` (idempotent, runs on startup)

### Session 8 — Admin API and admin panel ✅
New endpoints (all require `user_access = 'admin'` — enforced once auth is live):

```
POST   /api/admin/organisations                  create org
GET    /api/admin/organisations                  list all orgs
PUT    /api/admin/organisations/{id}             update org
POST   /api/admin/organisations/{id}/disable     disable org
POST   /api/admin/organisations/{id}/enable      enable org
POST   /api/admin/users                          create user, assign to org
GET    /api/admin/users                          list all users (with org name)
PUT    /api/admin/users/{id}                     update user
POST   /api/admin/users/{id}/disable             disable user
POST   /api/admin/users/{id}/enable              enable user
GET    /api/admin/sessions                       list all sessions across all orgs
GET    /api/admin/audit                          last 500 audit trail entries across all orgs
GET    /api/me                                   returns current user's name, email, org, access level
```

Admin panel UI (`src/components/AdminPanel.tsx`) — tabs for Organisations, Users, Sessions, Audit Trail.

---

## Phase 2 — Auth0 Authentication (3 sessions)

### Session 9 — Auth0 setup + JWT validation + React login + auto-provisioning ✅
**Auth0 side (done manually):**
- Created SPA application on Auth0 dashboard (domain: `winedruid.uk.auth0.com`)
- Created API with identifier `https://vinodruid/api`
- Configured allowed callback/logout URLs for `http://localhost:5173`
- Added Auth0 Action on post-login trigger to include `email` claim in access token
- Created M2M application (vinoDruid Management) authorised against the Management API with `create:users` and `create:user_tickets` scopes

**FastAPI side:**
- Added `python-jose[cryptography]` and `certifi` to requirements
- `_get_jwks()` fetches and caches Auth0's public JWKS using certifi CA bundle (fixes Windows SSL cert store issue)
- `_verify_token(token)` validates RS256 signature, audience, issuer
- `_resolve_user(request)` extracts `email` from token claims, looks up `users` table, caches result on `request.state`
- `get_org_id()` and `get_user_id()` are thin wrappers over `_resolve_user()`
- `SKIP_AUTH=true` env var bypasses Auth0 and falls back to `DEV_ORG_ID`/`DEV_USER_ID` for local dev
- `_get_mgmt_token()` fetches a cached M2M access token from Auth0 Management API
- `_provision_auth0_user(email)` creates a user in Auth0 and returns a 7-day password-setup ticket URL
- `POST /api/admin/users` now auto-provisions the user in Auth0 before the DB insert; returns `setup_url` for the admin to send to the new user; Auth0 errors are non-fatal (user is always created in DB)
- `alias` field added to user INSERT and UPDATE queries

**React side:**
- Installed `@auth0/auth0-react`
- Wrapped app in `Auth0Provider` (`src/main.tsx`) with domain, client ID, audience, and `openid profile email` scopes
- `authFetch` callback in `App.tsx` and `AdminPanel.tsx` — calls `getAccessTokenSilently()` and attaches `Authorization: Bearer <token>` on every request
- Custom `LoginPage.tsx` shown to unauthenticated users, styled to match the app
- Logout button in the app header
- Admin panel user form: `alias` field added; after creating a new user the UI shows a copyable password-setup link in a green banner, and an amber warning if Auth0 provisioning failed

### UX improvements — manual entry, corrections, country normalisation, column swap ✅
Added between Sessions 9 and 10 based on internal feedback from Luc and James.

**Manual entry grid (`src/components/ManualEntryGrid.tsx`):**
- "Start from Empty" button on the upload screen opens an editable grid instead of a file upload
- Column picker modal: required columns locked, optional columns toggleable, saved to `localStorage` per key `vd_cols_${dataType}`
- Paste from clipboard: tab-separated columns, newline-separated rows, auto-extends the grid if pasted data exceeds current row count
- Submit sends rows through the same `processData` validation pipeline as a file upload

**Country normalisation (`src/utils/normalization.ts`):**
- `COUNTRY_ALIASES` map + `normalizeCountry(raw: string): string`
- Applied before validation in `processData` for every data type that has a country field
- Aliases: UK/GB/Britain/England → United Kingdom, US/USA → United States, NZ → New Zealand, SA/RSA → South Africa

**Column swap (`src/App.tsx`):**
- Swap icon (⇄) revealed on column header hover using `group/hdr` + `group-hover/hdr:` Tailwind named groups
- Click sets `swapSourceKey`; click a second header completes the swap
- File upload mode: swaps both sides of the column mapping then re-validates
- Manual entry mode: swaps the actual cell values across all rows then re-validates

**Upload corrections workflow (`src/App.tsx`):**
- Export Errors CSV now includes `__row_id__` as the last column (the row's stable index in the session)
- "Upload Corrections" button reads a corrected CSV, matches rows by `__row_id__`, replaces those rows in the current session data, and re-validates
- Falls back to position-based matching if the corrections file has no `__row_id__` column

### Session 10 — Role-based access enforcement ✅
Access levels simplified to two: `user` (upload, map, validate, export) and `admin` (full access including admin panel).

**Backend — `_require_admin(request: Request)` helper in `server.py`:**
```python
def _require_admin(request: Request) -> None:
    if _SKIP_AUTH:
        return
    _, user_id = _resolve_user(request)
    with get_db() as conn:
        cursor = conn.execute("SELECT user_access FROM users WHERE user_id = ?", (user_id,))
        row = row_as_dict(cursor)
    if not row or row.get("user_access") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
```
Applied as first call in all 12 admin endpoints: `admin_list_orgs`, `admin_create_org`, `admin_update_org`, `admin_disable_org`, `admin_enable_org`, `admin_list_users`, `admin_create_user`, `admin_update_user`, `admin_disable_user`, `admin_enable_user`, `admin_list_sessions`, `admin_list_audit`.

**Frontend:** Admin panel tab hidden for non-admin users. Access level (`user` / `admin`) set when creating a user via the admin panel.

### MFA (multi-factor authentication) ✅
Added on its own branch (`feature/mfa`), separate from Session 10.

**Auth0 side:**
- Upgraded Auth0 tenant from Free to the Essentials plan — MFA is not available at all on Free, including basic TOTP
- Enabled the One-time Password (TOTP) factor (Google Authenticator / Authy compatible)
- Policy set to "Always" — every login requires a code after password

**`src/main.tsx` — switched from silent-auth (iframe) token renewal to refresh tokens:**
```tsx
<Auth0Provider
  domain={import.meta.env.VITE_AUTH0_DOMAIN}
  clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
  useRefreshTokens={true}
  cacheLocation="localstorage"
  authorizationParams={{
    redirect_uri: window.location.origin,
    audience: import.meta.env.VITE_AUTH0_AUDIENCE,
    scope: 'openid profile email offline_access',
  }}
>
```
Root cause this replaces: Auth0's silent token renewal happens in a hidden iframe (`prompt=none`). MFA set to "Always" cannot be completed inside a hidden iframe, so silent renewal failed and looped indefinitely once MFA was turned on. Refresh tokens remove the need for the iframe entirely.

**Two follow-up bugs found and fixed in `src/App.tsx` after the above was live** (MFA worked, but the app showed no org name, no admin panel, no sessions):
- `authFetch` called `getAccessTokenSilently()` independently for every request that fired on page load (master cellars, master clients, regions, sessions, `/api/me` — five parallel calls). Refresh token rotation invalidates the token on every use, so concurrent calls could race and use an already-rotated token. Fixed by de-duplicating concurrent token fetches behind a single shared `tokenPromiseRef`.
- The `useEffect` hooks that load master data/sessions and `/api/me` depended only on `[authFetch]`, with no check on `isAuthenticated`. They fired once, immediately on mount, before the redirect-based login + MFA flow had finished — and since `authFetch`'s reference never changes, they never re-ran once login actually completed. This was the real blocker. Fixed by adding `if (!isAuthenticated) return;` and `isAuthenticated` to both effects' dependency arrays.

Full diagnosis and fix history in memory note `project_mfa_solution.md`.

### Scalability fix + LWIN bypass + bulk-fix extension + regions DB fix ✅
Added on its own branch (`feature/scalability-fix`), separate from Session 10.

**Scalability — frontend (`src/App.tsx`):**
- `processData` converted from synchronous to `async`; validation runs in 300-row chunks with `await yieldToMain()` (`setTimeout(resolve, 0)`) between each chunk so the browser tab stays responsive during large uploads
- Progress bar overlay added using `motion` + `AnimatePresence`; shows `done / total` rows as each chunk completes
- Review table paginated: `reviewPage` / `reviewPageSize` state, rows sliced before render, rows-per-page selector, first/prev/next/last buttons, page clamped when filtered set shrinks
- All ~20 `processData` call sites updated to `await processData(...)` with enclosing functions made `async`

**Scalability — backend (`server.py`):**
- `_executemany_batched(conn, sql, params_list, batch_size=1000)` helper added — sets `cursor.fast_executemany = True` and inserts in 1,000-row batches
- `create_session` now uses `_executemany_batched` for row inserts and writes one summary audit log entry per upload (not one per row)
- `bulk_update_rows` now uses `_executemany_batched`

**LWIN bypass rule (`src/App.tsx`, `src/components/RulesModal.tsx`):**
- When a row has a valid 7-digit LWIN (`lwin7` stripped to digits, length === 7) and the data type is inventory, client_reserves, sales_orders, or purchase_orders: region/sub-region checks skipped, country reference check short-circuited, vintage INVALID error suppressed, wine name special-char check skipped, type and sub_type validation bypassed (value passed through as-is), sub_type type-compatibility check skipped
- `type` and `sub_type` added to the post-loop no-LWIN required fields check (alongside producer, country, region)
- `RulesModal.tsx`: LWIN rule description updated to document bypass; dead imports `CheckCircle2` and `AlertTriangle` removed

**Bulk-fix suggestion extension (`src/App.tsx`):**
- `bulkFixableFields` extended to include `type`, `sub_type`, `currency`, `warehouse_location`, `tax_status`, `packaging_type`

**Regions DB fix:**
- Two entries both named `Jura` existed: one with `parent=France` (correct) and one with `parent=German Swiss` (Swiss canton). The frontend's `.find()` could pick either, causing Arbois to resolve to Switzerland instead of France
- Swiss entry renamed to `Jura (Switzerland)`; existing `Arbois` entry (which had the wrong parent chain) deleted and re-inserted with `parent='France'` directly

### Session 11 — Auth testing and hardening
- End-to-end test of full auth flow: create user in Auth0, log in, confirm correct organisation loads
- Test data isolation: confirm a token from org A cannot retrieve org B's sessions or data
- Test disable flow: disable a user in the admin panel, confirm they are blocked on next request
- Fix anything found during testing

---

## Phase 3 — Azure Infrastructure (4 sessions)

### Session 12 — Azure SQL: setup & schema migration
- Create Azure resource group: `vinoDruid-rg`
- Create Azure SQL Server + Database:
  - Server: `vinodruid-sql.database.windows.net`
  - Database: `WineOnboarding`
  - Tier: General Purpose Serverless (scales to zero, cost-effective for start)
  - Enable Azure AD authentication
  - Firewall: allow your IP + Azure services
- Update `server.py` connection string:
  - Switch pyodbc driver to `ODBC Driver 18 for SQL Server`
  - Use connection string from Key Vault (local: from `.env`)
- Run `init_db()` against Azure SQL — creates all tables
- Manually insert one organisation + one user to verify the full stack

### Session 13 — Azure App Service: deploy FastAPI
- Create App Service (Linux, Python 3.12):
  - Name: `vinodruid-api`
  - Plan: B1 (cheapest paid tier — needed for always-on)
- Deployment method: GitHub Actions or zip deploy from local
- `startup.sh`: `uvicorn server:app --host 0.0.0.0 --port 8000`
- App Service Configuration (environment variables):
  - `DB_CONNECTION_STRING` → Key Vault reference
  - `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`
  - `SKIP_AUTH=false`
- Create Azure Key Vault:
  - Store DB connection string as a secret
  - Grant App Service managed identity access to Key Vault
- Test: `https://vinodruid-api.azurewebsites.net/api/sessions` returns 200

### Session 14 — Azure Static Web Apps: deploy React
- Create Azure Static Web App:
  - Name: `vinodruid-app`
  - Build: `npm run build`, output: `dist`
  - Link to GitHub repo for automatic deploys on push
- `staticwebapp.config.json`:
  - SPA fallback: all routes → `index.html`
  - API proxy: `/api/*` → `https://vinodruid-api.azurewebsites.net`
- Update Auth0 SPA application: add the Static Web App URL to allowed callback/logout/web origins
- Set React env vars (`VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`) in Static Web App config
- Test: open the Azure URL, log in via Auth0, see the home screen

### Session 15 — Key Vault, CORS, environment hardening
- Lock down CORS in server.py: replace `allow_origins=["*"]` with the specific Static Web App URL
- Key Vault: store all secrets (no secrets in App Service config directly — only Key Vault refs)
- Enable Azure Managed Identity on App Service (no stored credentials)
- Set up custom domain if needed (optional at this stage)
- Review App Service logs: confirm no unhandled exceptions on startup
- Confirm `GET /api/master/regions` returns 3026 rows from Azure

---

## Phase 4 — Integration Testing in Azure (3 sessions)

### Session 16 — End-to-end test: all data types in Azure
Using the live Azure environment:
- Log in via Entra ID
- Upload and process each data type: inventory, client reserves, sales orders, purchase orders
- Upload cellars list → verify it saves and validates in subsequent imports
- Upload clients list → verify account code validation works
- Test mixed LWIN/no-LWIN file → verify per-row errors appear correctly
- Export a cleaned CSV → verify format is correct
- Resume a session → verify it reloads correctly from Azure SQL

### Session 17 — Multi-tenant data isolation test
- Create a second organisation in the DB
- Assign a second Entra user to that org
- Log in as Org A → import data, create sessions
- Log in as Org B → verify zero sessions, zero cellars, zero clients visible
- Try to directly call `GET /api/sessions/{id}` with Org B's token for Org A's session → expect 403 or 404
- Try to call `GET /api/master/cellars` as Org B → should return empty, not Org A's cellars
- Document the test results as proof of isolation

### Session 18 — Bug fixes from Azure testing
- Fix any bugs found in Sessions 16–17
- Fix any environment-specific issues (timeouts, connection pooling, cold start latency)
- Re-test anything that was broken
- Verify Azure SQL connection handling under concurrent requests (pyodbc thread safety)
- Performance check: does processing a 500-row file feel acceptable in Azure?

---

## Phase 5 — Hardening & Monitoring (2 sessions)

### Session 19 — Logging, monitoring, error tracking
- Enable Azure Application Insights on App Service:
  - Automatic request/response logging
  - Exception tracking
  - Dependency tracking (SQL queries)
- Add structured logging to server.py:
  - Log every import session start/end with org_id and row count
  - Log auth failures (wrong org, missing user)
  - Do NOT log row content (data privacy)
- Set up a basic alert: email notification if the API returns 500 more than 3 times in 5 minutes
- Review the first week of logs — check for unexpected errors

### Session 20 — Security review & sign-off
- Security checklist:
  - CORS locked to specific domain ✓
  - All endpoints require valid JWT ✓
  - All queries scoped to organisation_id ✓
  - No secrets in code or App Service config (Key Vault only) ✓
  - Auth0 tokens validated with JWKS (not just decoded) ✓
  - Admin endpoints require `role = 'admin'` ✓
- Fix anything that needs attention
- Platform is considered live and stable after this session

---

## Phase 6 — Operational Runbook (4 sessions)

Each session covers one area of operations: the process is documented and then walked through live to confirm it works exactly as written. The output is a reference document anyone responsible for the platform can follow without needing to understand the code.

### Session 21 — Adding a new organisation
- Document step-by-step: create org record in DB, confirm data isolation is in place
- Walk through it with a real example end-to-end
- Confirm the new org can log in and sees only their own empty workspace

### Session 22 — Creating and managing users
- Document: create user via admin panel (auto-registers in Auth0, sends password-setup link), confirm login works
- Document: revoke access when a user leaves (disable in Auth0 + disable in admin panel)
- Document: change a user's role
- Walk through each scenario, confirm all three work

### Session 23 — Deploying updates
- Document the full deployment path: local change → push → App Service redeploy → verify
- Cover pre-deploy checks (does the API still start? do tests pass?)
- Cover rollback: how to revert to a previous deployment if something breaks
- Run through a real deployment to validate every step

### Session 24 — Reading logs and responding to alerts
- Document where to find logs in Application Insights and what to look for
- Document what a healthy API looks like vs signs of a problem
- Document the alert: when it fires, what it means, first steps to investigate
- Simulate a failure (e.g. wrong DB connection string) and walk through diagnosing and fixing it
- Project is done

---

## Summary timeline

| Week | Session | Phase | Deliverable |
|---|---|---|---|
| 1 | 1 | 0 | ✅ PO schema + home screen entry point |
| 2 | 2 | 0 | ✅ PO upload → map → LWIN logic |
| 3 | 3 | 0 | ✅ PO review + validation + export |
| 4 | 4 | 0 | ✅ Full regression test, all bugs fixed |
| 5 | 5 | 0 | ✅ App stable, polished & frozen |
| 6 | 6+7 | 1 | ✅ organisations + users tables, org_id on all tables, all queries scoped |
| 7 | — | — | ✅ combined into session 6 |
| 8 | 8 | 1 | ✅ Admin API endpoints + admin panel UI |
| 9 | 9 | 2 | ✅ Auth0 setup + FastAPI JWT + React login |
| 10 | 10 | 2 | ✅ Role-based access enforcement (admin check on all 12 endpoints); ✅ MFA (TOTP, refresh tokens) |
| 11 | 11 | 2 | Auth testing and hardening |
| 12 | 12 | 3 | Azure SQL provisioned + schema migrated |
| 13 | 13 | 3 | FastAPI deployed to App Service |
| 14 | 14 | 3 | React deployed to Static Web Apps |
| 15 | 15 | 3 | Key Vault, CORS hardened |
| 16 | 16 | 4 | End-to-end test in Azure |
| 17 | 17 | 4 | Multi-tenant isolation test |
| 18 | 18 | 4 | Azure bug fixes |
| 19 | 19 | 5 | Logging + Application Insights |
| 20 | 20 | 5 | Security review + sign-off |
| 21 | 21 | 6 | Runbook: adding a new organisation |
| 22 | 22 | 6 | Runbook: creating and managing users |
| 23 | 23 | 6 | Runbook: deploying updates |
| 24 | 24 | 6 | Runbook: logs and alerts + project done |

**Total: 24 weeks (~6 months at 1 session/week)**

---

## Decisions already made
- Multi-tenancy: shared DB + `organisation_id` (Option A)
- Auth: Auth0 (SPA + API, RS256 JWT, JWKS validation)
- User provisioning: admin-created in Auth0 + matched by email in the users table (no self-sign-up)
- Regions: global, not per-org
- Billing: deferred, out of scope

## Deferred / future
- Billing and subscription management
- Azure Blob Storage for uploaded file archiving
- Email notifications (import complete, errors found)
- Audit trail UI (table exists, not yet surfaced in the app)
- User self-service (password reset, profile — Entra handles this natively)
- Purchase orders UI beyond basic import (approvals, PO matching, etc.)
