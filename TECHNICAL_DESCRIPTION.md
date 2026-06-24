# vinoDruid — Technical Description

---

## Architecture

```
Browser (React SPA)
  └── Vite dev server  :5173
        └── FastAPI (Python)  :3000
              └── SQL Server Express  WOLUCA\SQLEXPRESS / WineOnboarding
```

The frontend communicates with the backend exclusively through the REST API. File parsing happens entirely in the browser — data is sent as JSON after parsing. The backend handles persistence, session management, and master data.

---

## Technology stack

### Frontend

| Technology | Version | Role |
|---|---|---|
| React | 19 | UI framework |
| Vite | 6 | Build tool and dev server |
| TypeScript | 5.8 | Type safety |
| Tailwind CSS | 4 | Styling |
| Motion (Framer) | 12 | Animations |
| ExcelJS | 4.4 | Excel (.xlsx) file parsing |
| PapaParse | 5.5 | CSV parsing |
| Lucide React | 0.546 | Icons |

### Backend

| Technology | Version | Role |
|---|---|---|
| Python | 3.12 | Runtime |
| FastAPI | 0.115+ | REST API framework |
| Uvicorn | 0.32+ | ASGI server |
| pyodbc | 5.0+ | SQL Server connectivity |
| python-dotenv | 1.0+ | Environment variable loading |

---

## Source file map

| File | Responsibility |
|---|---|
| `server.py` | FastAPI app, all API endpoints, DB schema creation and seeding |
| `src/App.tsx` | Central application state, all data processing and validation logic |
| `src/components/SchemaMapper.tsx` | Column mapping step — auto-detection, auto-calc hints, either/or gate |
| `src/components/RowEditor.tsx` | Row-level error correction modal |
| `src/components/FileUploader.tsx` | Drag-and-drop file input with CSV/XLSX format detection |
| `src/components/DateInput.tsx` | Free-text date entry with live preview, format normalisation, calendar picker |
| `src/components/DuplicateComparisonModal.tsx` | Side-by-side comparison for resolving flagged duplicates |
| `src/components/CellarAutocomplete.tsx` | Autocomplete input backed by master_cellars list |
| `src/components/RulesModal.tsx` | Validation rules reference panel |
| `src/utils/normalization.ts` | Normalisation helpers: dates, bottle sizes, vintages, currencies |
| `src/utils/wineValidation.ts` | Wine type/subtype reference data and fuzzy matching |

---

## Database

**SQL Server Express** at `WOLUCA\SQLEXPRESS`, database `WineOnboarding`, Windows Authentication.

All tables are created automatically by `init_db()` on server start (`IF NOT EXISTS` guarded):

| Table | Description |
|---|---|
| `sessions` | One row per import session — file name, data type, status, current step, field mapping |
| `session_rows` | All rows for a session stored as JSON blobs; `UNIQUE(session_id, row_index)` |
| `audit_trail` | Field-level change log: old value, new value, change type, timestamp |
| `master_cellars` | Cellar name master list — populated by importing a Cellars file |
| `master_clients` | Account code master list — populated by importing a Clients file |
| `regions` | Wine region/country reference table — global, 3,026 entries |

The `regions` table is seeded automatically on the first server start if the table is empty. Subsequent restarts skip seeding.

---

## Supported data types

| Type | Description |
|---|---|
| `inventory` | Wine stock held in cellars |
| `client_reserves` | Wines allocated to specific clients |
| `sales_orders` | Customer sales transactions |
| `purchase_orders` | Supplier purchase transactions |
| `cellars` | Physical storage location master data |
| `trade_clients` | Business account master data |
| `private_clients` | Individual client master data |
| `suppliers` | Supplier master data |

---

## Import workflow

```
File selected (CSV or XLSX)
  → Parsed in browser (ExcelJS / PapaParse)
  → Headers extracted
  → SchemaMapper displayed — auto-detects column matches
  → User confirms / adjusts mapping
  → handleMappingComplete()
  → processData() — per-row validation
  → Review table displayed (green = clean, red = errors)
  → User fixes errors via RowEditor, bulk actions, or inline editing in the comparison modal
  → handleCalculationSmartFix() fills derivable fields
  → Export: cleaned rows downloaded as CSV (Export Clean CSV)
  → Export errors: red rows only downloaded as CSV with an added "Errors to Fix" column (Export Errors button — only visible when errors exist)
  → Session auto-saved to DB at every stage
```

---

## LWIN / no-LWIN per-row logic

For `inventory`, `client_reserves`, `sales_orders`, and `purchase_orders`, wine identity is validated per row — not as a file-level setting:

| Row has | Validation |
|---|---|
| Valid LWIN7 (7-digit code) | LWIN accepted; wine name, type, country, region not required |
| No LWIN | Wine name + vintage + wine type all required; row flagged red if any missing |
| LWIN present but wrong format | Row flagged red: "LWIN7 must be exactly 7 digits" |

A file can contain rows with and without LWINs — each is validated independently. The mapper requires that at least one of `lwin7` or `listing_wine_name` is mapped before the step can be completed.

**Always required regardless of LWIN:** vintage, plus all transaction fields (case size, quantities, price, tax status, account code, etc.).

---

## Validation engine

`processData()` in `App.tsx` runs per-row, per-field:

| Check | Detail |
|---|---|
| Required field missing | Per schema definition + per-row LWIN logic |
| LWIN format | Exactly 7 digits |
| Vintage | Valid year 1900–present, or `NV`; empty vintage stays empty and is caught by required-field check where applicable |
| Bottle size | Normalised to cl; handles ml, L, named sizes (Magnum, etc.) |
| Country | Must exist in `regions` table with `type = 'Country'` |
| Region / Sub-region | Must exist in `regions` table; parent hierarchy checked against country |
| Wine type | Validated against internal `WINE_TYPES` list |
| Tax status | Must be `IB` or `DP` |
| Email | Must contain exactly one `@` and no spaces |
| Names / Surnames | Letters (including accented), spaces, hyphens, apostrophes, dots only — anything else flagged red |
| Account code / Cellar code | Alphanumeric plus hyphens, underscores, slashes, dots — special characters flagged red |
| Address lines | Unicode letters, digits, and standard punctuation only (`,.'-/#&()`) — other symbols flagged red |
| City / County | Letters, spaces, hyphens, apostrophes, dots only — digits and other symbols flagged red |
| Company name / Cellar name | Letters, digits, and common business punctuation — symbols such as `@`, `$`, `%` flagged red |
| Post code | Letters, digits, spaces, hyphens only |
| Numeric fields | Quantities, sizes, prices — must parse as numbers |
| Date fields | Normalised via `normalizeDate()`; flagged if unrecognisable |
| Cellar name | Also checked against `master_cellars` if master list is loaded |
| Account code | Also checked against `master_clients` if master list is loaded |
| Duplicates | Fingerprinted per data type; duplicates flagged with comparison modal |
| Price anomalies | Outliers flagged against per-wine median and global dataset median |

---

## Date normalisation

`normalizeDate()` (`src/utils/normalization.ts`) accepts many input formats and outputs `dd/mm/yyyy`:

| Input | Output |
|---|---|
| `1/2/25` | `01/02/2025` |
| `2025-02-01` | `01/02/2025` |
| `01.02.2025` | `01/02/2025` |
| `2 Jan 2025` | `02/01/2025` |
| `January 2, 2025` | `02/01/2025` |
| Excel serial number | Correctly converted |

The `DateInput` component shows a live preview of the parsed date while typing and includes a calendar picker popup (Monday-first grid, today highlighted).

---

## Auto-calculation

`handleCalculationSmartFix()` fills derived fields where source data is available:

| Derived field | Formula | Notes |
|---|---|---|
| Case Quantity | Total Qty ÷ Case Size | All wine types |
| Total Quantity | Case Size × Case Qty | Inventory and Client Reserves only — NOT Sales Orders or Purchase Orders |
| Total Value | Price × Qty | All types |
| Unit Price | Case Price ÷ (Case Size × Size / 75cl) | All types |

The SchemaMapper shows an "Auto-Calc" badge when a required field can be derived, letting the user proceed without mapping that column. Fields marked `noAutoCalc: true` in the schema are never auto-filled.

---

## Session management

Sessions are persisted throughout the workflow:

- **Created** when a file is uploaded
- **Updated** after every mapping change, row fix, or bulk action
- **Resumed** from the home screen — restores current step, mapping, and all row data
- **Reopened** for editing after being marked complete
- **Soft-deleted** — disabled sessions are hidden in the UI but retained in the DB

Session state is stored in a `fields` JSON blob on the `sessions` table: current step, file name, data type, column mapping, auto-fix logs, manual edit map, ignored duplicates, ignored price warnings.

---

## Master data

Cellars and clients master lists drive validation across all wine import types:

- **Cellars** — loaded into `master_cellars` by importing a Cellars file; cellar names in subsequent inventory/reserves/orders imports are checked against this list
- **Clients** — loaded into `master_clients` by importing a trade or private clients file; account codes in reserves and orders are checked against this list

If no master data is loaded, cellar and account code checks are skipped (no false errors on a fresh install).

---

## Regions reference table

The `regions` table contains 3,026 entries covering countries, wine regions, sub-regions, and communes worldwide:

| Column | Description |
|---|---|
| `region_name` | Name (country, region, sub-region, commune, or continent) |
| `type` | `Country`, `Region`, `Sub-Region`, `Commune-Locale`, `Continent` |
| `parent` | Parent region name — enables hierarchy traversal |
| `appellation` | Appellation name if applicable |
| `classification` | e.g. Premier Cru, Grand Cru |
| `designation` | e.g. AOC, DOCG, DOC |

Served via `GET /api/master/regions` and loaded by the frontend on mount. The validation engine uses the parent hierarchy to confirm a region or sub-region belongs to the expected country.

---

## API endpoints

All endpoints are served by FastAPI at `http://localhost:3000`. Interactive docs at `/docs`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/sessions` | List all active sessions |
| POST | `/api/sessions` | Create a new session |
| GET | `/api/sessions/{id}` | Load a session with all rows |
| PATCH | `/api/sessions/{id}` | Update session status or fields |
| DELETE | `/api/sessions/{id}` | Soft-delete a session |
| POST | `/api/sessions/{id}/rows/bulk` | Bulk upsert session rows |
| GET | `/api/master/cellars` | Get master cellar list |
| POST | `/api/master/cellars` | Replace master cellar list |
| DELETE | `/api/master/cellars` | Clear master cellar list |
| GET | `/api/master/clients` | Get master client/account list |
| POST | `/api/master/clients` | Replace master client list |
| DELETE | `/api/master/clients` | Clear master client list |
| GET | `/api/master/regions` | Get full regions reference table |

---

## Development

### Prerequisites
- Node.js 18+, Python 3.12+
- SQL Server Express at `WOLUCA\SQLEXPRESS`
- ODBC Driver 17 or 18 for SQL Server

### Setup
```
npm install
pip install -r requirements.txt
```

### Run
```
npm run dev
```
Starts both servers via `concurrently`. Frontend at `:5173`, API at `:3000`.

### Environment (`.env`)
```
DB_SERVER=WOLUCA\SQLEXPRESS
DB_NAME=WineOnboarding
```
Windows Authentication — no password required on a local machine.
