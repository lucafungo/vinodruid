# Druid — Code Structure

## What the app does

Druid is an internal data-onboarding tool for wine businesses. Users upload spreadsheets of wine data (inventory, client reserves, sales orders, purchase orders and four more types), map their column headers to the app's schema, fix validation errors in a review table, and export a cleaned CSV. Sessions are saved to a database so work can be resumed across visits. Everything is multi-tenant: each organisation sees only its own sessions and master data.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion |
| Backend | Python 3.12, FastAPI, pyodbc |
| Database | SQL Server Express (local: `WOLUCA\SQLEXPRESS`) |
| Auth | Auth0 SPA — RS256 JWT, TOTP MFA, refresh tokens |
| AI stub | Claude (stubbed — the call site exists but AI responses are not wired in production) |

The frontend runs on port 5173 (Vite dev server). The backend runs on port 3000. In development both are started separately; in production the frontend is a static build proxied through a single domain.

## Repository layout

```
/
├── server.py               Python FastAPI backend, all endpoints in one file
├── requirements.txt        Python dependencies
├── .env                    Local secrets (never committed)
├── .env.example            Safe template showing which vars are needed
├── vite.config.ts          Vite + Tailwind build config, manual chunk splitting
├── tsconfig.json
├── PLAN.md                 Detailed session-by-session technical log
├── SESSIONS_OVERVIEW.md    Plain-language project summary for the PM
├── CODE_STRUCTURE.md       This file
│
├── src/
│   ├── main.tsx            React entry point, Auth0Provider wrapper
│   ├── App.tsx             Root component, all shared state, all event handlers
│   ├── types.ts            Shared TypeScript interfaces
│   ├── constants.ts        SCHEMAS definition and other top-level constants
│   │
│   ├── utils/
│   │   ├── processData.ts      Core validation engine (runProcessData)
│   │   ├── exportUtils.ts      CSV and Excel export helpers
│   │   ├── normalization.ts    Country name normalisation (UK → United Kingdom, etc.)
│   │   └── wineValidation.ts   Wine-specific field validators (LWIN, vintage, etc.)
│   │
│   └── components/
│       ├── AppHeader.tsx               Top bar: logo, user greeting, logout, mark-complete
│       ├── LoginPage.tsx               Auth0 login screen (shown when not authenticated)
│       ├── AdminPanel.tsx              Admin UI: organisations, users, sessions, audit trail
│       ├── SchemaMapper.tsx            Column mapping step (drag CSV headers to schema fields)
│       ├── UploadStep.tsx              File upload and manual entry entry point
│       ├── ManualEntryGrid.tsx         Spreadsheet-style grid for hand-entering data
│       ├── ColumnPickerModal.tsx       Optional column selector before manual entry
│       ├── ReviewTable.tsx             Review step: paginated table with inline cell editing
│       ├── ValidationProgressOverlay.tsx  Progress bar shown during chunked validation
│       ├── FileUploader.tsx            Drag-and-drop / file picker widget
│       ├── RulesModal.tsx              Validation rules reference shown on demand
│       ├── AiFixReviewModal.tsx        Modal for reviewing AI-suggested fixes before applying
│       ├── DuplicateComparisonModal.tsx  Side-by-side view for resolving duplicate rows
│       ├── CellarAutocomplete.tsx      Autocomplete input for cellar name fields
│       ├── DateInput.tsx               Date input with format validation
│       ├── AddLocationModal.tsx        Modal to add a new cellar location inline
│       └── RowEditor.tsx               Inline row editor (alternative to per-cell editing)
│
└── scripts/
    └── generateRegionData.ts   One-off script used to seed the regions reference table
```

## Frontend architecture

### State lives in App.tsx

App.tsx is the single source of truth for all application state. There is no global state library (no Redux, no Zustand). Every piece of state is a `useState` hook in App.tsx, and every event handler that modifies state is defined there too. Child components receive what they need as props.

The main state groups are:

- **Step state** — `step` tracks where the user is in the flow: `'home'`, `'upload'`, `'mapping'`, `'review'`, `'complete'`.
- **Data state** — `rawData` (the original rows from the file), `processedData` (validated and annotated rows ready for the table), `mapping` (CSV header to schema key mapping).
- **Edit tracking** — `manualEditsMap` (which fields have been manually corrected, keyed by row id), `autoFixedMap` (which fields were auto-fixed by the AI pass), `calculationLogsMap` (log of what the calculation engine changed).
- **Session state** — `currentSessionId`, `sessions` (all sessions for the org), `history` (undo stack).
- **Master data** — `masterCellars`, `masterClients`, `regionRefData` — loaded from the backend on mount and used for validation.
- **UI state** — `pendingBulkAction`, `editingCell`, `reviewPage`, `isValidating`, `isAiProcessing`, and others.

### The data flow through the app

```
File upload / manual entry
        ↓
  rawData (raw CSV rows, no validation)
        ↓
  SchemaMapper: user maps CSV headers to schema keys
        ↓
  mapping (Record<schemaKey, csvHeader>)
        ↓
  runProcessData (src/utils/processData.ts)
        — applies mapping, normalises country names, validates every field,
          detects duplicates, computes statuses (green / amber / red)
        ↓
  processedData (ProcessedRow[])
        ↓
  ReviewTable: user fixes errors inline
        — each edit calls handleRowUpdate in App.tsx
        — handleRowUpdate updates rawData, updates manualEditsMap,
          detects bulk-fix candidates, calls runProcessData again
        ↓
  Export: rowsToCsv writes processedData to a clean CSV
```

### processData — the core engine

`runProcessData` in `src/utils/processData.ts` is the most important function in the codebase. It takes raw rows plus all the current tracking maps and returns `ProcessedRow[]`. It runs in chunks of 300 rows, yielding to the browser between each chunk via `setTimeout(resolve, 0)` so the tab stays responsive on large files.

For each field in each row, `getValue` applies a three-priority rule:

1. **Manual edit** — if the field was manually corrected by the user (`manualEditsMap` includes it), use the value from `rawData[fieldKey]` directly, even if it overrides what the CSV had.
2. **AI-calculated** — if `autoFixedMap` has a value for this field, use it.
3. **Mapped column** — read the CSV column that the user mapped to this schema key.

After values are resolved, every field goes through type-specific validators in `wineValidation.ts` (LWIN format, vintage year range, quantity/price checks, country/region cross-reference, duplicate fingerprinting, and so on).

`processData` in App.tsx wraps `runProcessData`. It adds version tracking: each call increments `processDataLatestId`. Only the most recently started call is allowed to commit its result to `setProcessedData`. This prevents a slow earlier call from overwriting a newer call's result when multiple edits happen in quick succession.

### The bulk-fix suggestion

When the user fixes a cell in the review table, `handleRowUpdate` checks whether other red rows have the same old value for the same field. If they do, `setPendingBulkAction` is called, which shows the bulk-fix banner asking the user whether to apply the same fix to all similar rows. Bulk-fix is supported for a defined list of fields in `BULK_FIXABLE_FIELDS` (in `src/constants.ts`).

### Schemas and data types

`SCHEMAS` in `src/constants.ts` defines every supported data type. Each entry names the type, provides a human-readable label, and lists every field with its key, label, whether it is required, its data type, and validation rules. `App.tsx` reads the active schema via `getCurrentSchema()` and passes it down to the mapper, validator, and table.

The supported data types are: `inventory`, `client_reserves`, `sales_orders`, `purchase_orders`, `cellars`, `clients`, `contacts`, `price_list`.

### Auth0 and token handling

`src/main.tsx` wraps the app in `Auth0Provider` with refresh tokens enabled (`useRefreshTokens: true`, `cacheLocation: 'localstorage'`). This is required because MFA is enabled and silent renewal (which uses a hidden iframe) cannot complete an MFA challenge.

`authFetch` in App.tsx is the single function used for every API call. It calls `getAccessTokenSilently()` and attaches `Authorization: Bearer <token>`. Concurrent calls share a single token promise via `tokenPromiseRef` to avoid the race condition that refresh token rotation would otherwise cause.

## Backend architecture

All backend code is in `server.py`. There is no module split.

### Middleware

Two custom middleware classes run on every request:

- `_SecurityHeadersMiddleware` — adds `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, and `Referrer-Policy` to every response.
- `_MaxBodySizeMiddleware` — rejects requests with bodies over the configured size limit before they reach the endpoint.

### Auth helpers

- `_get_jwks()` — fetches Auth0's public JWKS and caches it in memory with a TTL. Uses the certifi CA bundle (needed on Windows where Python does not use the system cert store by default).
- `_verify_token(token)` — validates the RS256 signature, audience, and issuer.
- `_resolve_user(request)` — extracts the email from the token claims, looks it up in the `users` table, and caches the result on `request.state` so the same request does not hit the DB twice.
- `get_org_id(request)` and `get_user_id(request)` — thin wrappers over `_resolve_user`.
- `_require_admin(request)` — called at the top of every admin endpoint; raises HTTP 403 if the user does not have `user_access = 'admin'`.
- `SKIP_AUTH=true` in `.env` bypasses all of the above for local development, falling back to `DEV_ORG_ID` and `DEV_USER_ID`.

### Database helpers

- `get_db()` — context manager that acquires a connection from a simple hand-rolled pool, yields it, and releases it on exit.
- `rows_as_dicts(cursor)` and `row_as_dict(cursor)` — convert pyodbc cursor rows to plain Python dicts using the column names from `cursor.description`.
- `_executemany_batched(conn, sql, params_list, batch_size=1000)` — sets `cursor.fast_executemany = True` and inserts rows in 1,000-row batches, used for session row inserts and bulk updates.
- `init_db()` — called on startup; creates all tables if they do not exist and runs idempotent column additions for schema migrations.

### API endpoints

```
GET  /api/me                              Current user identity and access level
GET  /api/sessions                        List all sessions for the organisation
POST /api/sessions                        Create a new session (with all rows)
GET  /api/sessions/{id}                   Load a saved session (rows + metadata)
PATCH /api/sessions/{id}                  Update session metadata (name, status)
PATCH /api/sessions/{id}/rows/{row_index} Update a single row
POST /api/sessions/{id}/rows/bulk         Bulk-update multiple rows
DELETE /api/sessions/{id}                 Delete a session

GET  /api/master/cellars                  List master cellars for the organisation
POST /api/master/cellars                  Replace master cellars list
GET  /api/master/clients                  List master clients
POST /api/master/clients                  Replace master clients list
GET  /api/master/regions                  List all regions (global, not per-org)

GET  /api/admin/organisations             List all organisations (admin only)
POST /api/admin/organisations             Create organisation (admin only)
PUT  /api/admin/organisations/{id}        Update organisation (admin only)
POST /api/admin/organisations/{id}/disable
POST /api/admin/organisations/{id}/enable
GET  /api/admin/users                     List all users across all orgs (admin only)
POST /api/admin/users                     Create user — also provisions in Auth0 (admin only)
PUT  /api/admin/users/{id}               Update user (admin only)
POST /api/admin/users/{id}/disable
POST /api/admin/users/{id}/enable
GET  /api/admin/sessions                  All sessions across all orgs (admin only)
GET  /api/admin/audit                     Last 500 audit trail entries (admin only)
```

### Database schema

All tables are created by `init_db()` on first startup.

| Table | Purpose |
|---|---|
| `organisations` | One row per tenant |
| `users` | One row per user, linked to an organisation |
| `sessions` | One row per import session, scoped to an organisation |
| `session_rows` | One row per data row within a session |
| `audit_trail` | One row per significant action (upload, export, etc.) |
| `master_cellars` | Cellar list per organisation, used for validation |
| `master_clients` | Client/account code list per organisation |
| `regions` | Global wine regions reference table (not per-org) |

Every table except `regions` has `organisation_id INT NOT NULL` and every query filters by it.

## Environment variables

These go in `.env` (never committed — only `.env.example` is in the repo):

| Variable | Used by | Purpose |
|---|---|---|
| `DB_CONNECTION_STRING` | server.py | pyodbc connection string to SQL Server |
| `AUTH0_DOMAIN` | server.py + Vite | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | server.py + Vite | Auth0 API identifier |
| `AUTH0_MGMT_CLIENT_ID` | server.py | M2M app client ID for user provisioning |
| `AUTH0_MGMT_CLIENT_SECRET` | server.py | M2M app client secret |
| `VITE_AUTH0_CLIENT_ID` | Vite | SPA client ID (different from M2M) |
| `SKIP_AUTH` | server.py | Set to `true` to bypass JWT validation locally |
| `DEV_ORG_ID` | server.py | Organisation ID to use when `SKIP_AUTH=true` |
| `DEV_USER_ID` | server.py | User ID to use when `SKIP_AUTH=true` |

## How to run locally

```bash
# Backend
pip install -r requirements.txt
uvicorn server:app --port 3000 --reload

# Frontend (separate terminal)
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:3000` so the frontend makes API calls to the same origin and avoids CORS issues in development.
