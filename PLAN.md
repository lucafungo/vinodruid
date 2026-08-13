# vinoDruid — Project Plan

**Cadence:** 1 session/week × 4 hours  
**Stack:** React + Vite · Python FastAPI · SQL Server → Azure SQL · Azure Entra ID  
**Multi-tenancy model:** Shared DB with `organisation_id` on every per-org table  
**Regions:** Global (no org scoping)  
**Auth:** Azure Entra ID, admin-provisioned users  
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

### Session 6 — New tables: organisations & users
Add two new tables to `init_db()` in server.py:

```sql
organisations (
  id INT IDENTITY PRIMARY KEY,
  name NVARCHAR(255) NOT NULL,
  slug NVARCHAR(100) NOT NULL UNIQUE,  -- short identifier, e.g. "wineowners"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

users (
  id INT IDENTITY PRIMARY KEY,
  entra_oid NVARCHAR(255) NOT NULL UNIQUE,  -- Azure Entra object ID
  email NVARCHAR(255) NOT NULL,
  display_name NVARCHAR(255),
  organisation_id INT NOT NULL REFERENCES organisations(id),
  role NVARCHAR(50) NOT NULL DEFAULT 'editor',  -- 'admin' | 'editor' | 'viewer'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

- Insert a test organisation and test user manually (SQL) to verify structure
- No API endpoints yet — just the tables
- Keep local dev working: add a `DEV_ORG_ID` env var that bypasses auth for local testing

### Session 7 — Add organisation_id to all per-org tables
Add `organisation_id INT NOT NULL` to:
- `sessions`
- `session_rows`
- `audit_trail`
- `master_cellars`
- `master_clients`

`regions` stays global — no `organisation_id`.

Update **every** SQL query in server.py:
- Every SELECT: add `WHERE organisation_id = ?`
- Every INSERT: include `organisation_id`
- Every DELETE: scope to org

Add helper `get_org_id(request)` in server.py — for now returns the hardcoded `DEV_ORG_ID` from env. This will be replaced with real JWT extraction in Phase 2 without touching any endpoint code.

Test: manually insert rows for two different org IDs and verify each org only sees its own data.

### Session 8 — Admin API: org & user management
New endpoints (all require `role = 'admin'` — enforced once auth is live, stubbed for now):

```
POST   /api/admin/organisations          create org
GET    /api/admin/organisations          list all orgs
POST   /api/admin/users                  create user, assign to org
GET    /api/admin/users                  list all users (with org name)
PATCH  /api/admin/users/{id}             update role or org
DELETE /api/admin/users/{id}             deactivate user
GET    /api/me                           returns current user's name, email, org, role
```

- Test all endpoints via Swagger UI (`http://localhost:3000/docs`)
- Confirm `GET /api/me` returns the right org for the hardcoded DEV user
- Confirm non-admin endpoints correctly block when role check is added later

---

## Phase 2 — Azure Entra ID Authentication (3 sessions)

### Session 9 — Azure setup + FastAPI JWT middleware
**Azure side (~1.5 hours):**
- Create Azure subscription (if not already done)
- Create Entra ID tenant or use existing Microsoft 365 tenant
- App Registration:
  - Name: `vinoDruid`
  - Supported account types: accounts in this org directory only
  - Redirect URI: `http://localhost:5173` (dev) + future Azure Static Web Apps URL
  - Add App Roles: `Admin`, `Editor`, `Viewer`
  - Note: Tenant ID, Client ID, set a Client Secret

**FastAPI side (~2 hours):**
- Add `python-jose[cryptography]` and `httpx` to requirements
- JWT middleware:
  - Fetch Entra's JWKS endpoint to validate token signatures
  - Extract `oid` (user's Entra object ID) from token
  - Look up `oid` in `users` table → get `organisation_id` + `role`
  - If user not found: return 403 with clear message
  - If token invalid/expired: return 401
- Replace `DEV_ORG_ID` stub in `get_org_id()` with real JWT extraction
- Keep the stub as a fallback when `DISABLE_AUTH=true` in env (for local dev speed)

### Session 10 — React login flow (MSAL)
- Install `@azure/msal-react` and `@azure/msal-browser`
- Create `src/auth/msalConfig.ts` with Tenant ID + Client ID (from env vars)
- Wrap App in `MsalProvider`
- Login page:
  - "Sign in with Microsoft" button
  - Redirect flow (not popup — cleaner for business users)
- On successful login:
  - Acquire access token silently for the API scope
  - Store token, attach as `Authorization: Bearer <token>` header on every `fetch` call
  - Fetch `GET /api/me` → store user name, org name, role in React context
- Protected route: if not authenticated, redirect to login page
- Show in top bar: user display name + organisation name
- Logout button clears MSAL cache and returns to login page

### Session 11 — Role-based access + user context in UI
- Role-based UI rules:
  - `viewer`: can see review screen and export, cannot upload or edit rows
  - `editor`: full access except admin pages
  - `admin`: full access + can see admin panel
- Enforce roles on the backend (middleware checks role per endpoint group)
- Add a minimal admin panel page in the UI:
  - List users in the org
  - Show their role and email
  - (Full user creation is done by you via API for now — UI is read-only)
- Show user initials avatar in top bar with role badge
- Test: log in as two different users in different orgs, confirm data isolation visually

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
  - `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`
  - `DISABLE_AUTH=false`
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
- Update MSAL config with production redirect URI (the Static Web App URL)
- Update Entra App Registration redirect URIs with the Static Web App URL
- Set React env vars (`VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_CLIENT_ID`) in Static Web App config
- Test: open the Azure URL, login with Microsoft, see the home screen

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
  - Entra tokens validated with JWKS (not just decoded) ✓
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
- Document: create user in Entra ID, assign to org, set role, confirm login works
- Document: revoke access when a user leaves (disable in Entra + flag in DB)
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
| 6 | 6 | 1 | organisations + users tables |
| 7 | 7 | 1 | org_id on all tables, all queries scoped |
| 8 | 8 | 1 | Admin API endpoints |
| 9 | 9 | 2 | Azure Entra setup + FastAPI JWT |
| 10 | 10 | 2 | React MSAL login flow |
| 11 | 11 | 2 | Role-based access + admin panel |
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
- Auth: Azure Entra ID
- User provisioning: admin-created (no self-sign-up)
- Regions: global, not per-org
- Billing: deferred, out of scope

## Deferred / future
- Billing and subscription management
- Azure Blob Storage for uploaded file archiving
- Email notifications (import complete, errors found)
- Audit trail UI (table exists, not yet surfaced in the app)
- User self-service (password reset, profile — Entra handles this natively)
- Purchase orders UI beyond basic import (approvals, PO matching, etc.)
