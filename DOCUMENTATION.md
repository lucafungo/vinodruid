# vinoDruid - Technical Documentation

This document provides a comprehensive technical overview of **vinoDruid**, a full-stack application designed to automate and streamline the ingestion of complex wine trade data (Listings, Inventory, and Reserves) into a standardized format.

---

## 1. Executive Summary
vinoDruid is a specialized ETL (Extract, Transform, Load) tool built to handle the high variability of wine trade spreadsheets. It combines rule-based validation with an AI-powered correction flow (Claude/Anthropic, pending configuration) to resolve data misalignments, extract embedded vintages, and normalize producer names.

---

## 2. System Architecture
The application follows a decoupled full-stack architecture with a Python backend and a React frontend.

- **Frontend:** React 19 with Vite, TypeScript, and Tailwind CSS (v4). Runs on port 5173 in development.
- **Backend:** Python 3.12 with FastAPI and Uvicorn (`server.py`). Runs on port 3000.
- **Database:** SQL Server Express (`WOLUCA\SQLEXPRESS`, database `WineOnboarding`) via `pyodbc` with Windows Authentication.
- **AI Engine:** Claude (Anthropic) — endpoint implemented, activated when `ANTHROPIC_API_KEY` is set.
- **Data Handling:** `papaparse`, `ExcelJS`, and `SheetJS` (`xlsx`) for client-side parsing of `.csv`, `.xls`, and `.xlsx` files.

### Database Schema
The `WineOnboarding` database uses eight tables:

- **`organisations`**: One row per tenant — name, organisation type, default country and currency, disabled flag.
- **`users`**: One row per user — linked to an organisation via `organisation_id`, stores alias, forename, surname, display name, email, access level (`admin` / `user`), and disabled flag. Passwords stored in plain text for Phase 1; replaced with Entra ID in Phase 2.
- **`sessions`**: Tracks session metadata — data type, mapping configuration, status, and timestamps. Scoped to `organisation_id`.
- **`session_rows`**: Stores row-level data as JSON, linked to a session via `session_id`. Has a unique constraint on `(session_id, row_index)` and an index on `session_id`. Scoped to `organisation_id`.
- **`audit_trail`**: Records every manual and AI-assisted change with `old_value`, `new_value`, and `change_type`. Indexed on `session_id`. Scoped to `organisation_id`.
- **`master_cellars`**: Cellar name master list, populated when a Cellars file is imported and marked complete. Scoped to `organisation_id`.
- **`master_clients`**: Account code master list, populated when a Clients or Suppliers file is imported. Scoped to `organisation_id`.
- **`regions`**: Global wine geography reference table — 3,026 entries covering countries, regions, sub-regions, and communes. Seeded automatically on first server start. Not org-scoped.

---

## 3. Frontend Workflow & Logic

### 3.1 Data Ingestion & Parsing
When a user uploads a file, the system uses `SheetJS` or `ExcelJS` (depending on file type) to parse the data into a JSON array. This raw data is stored in React state and persisted to the backend upon session creation.

### 3.2 Dynamic Column Mapping
The **Mapping Stage** enables users to link raw spreadsheet headers to target schema fields.
- **Fuzzy Matching:** Suggests initial mappings based on header similarity using a Levenshtein-based algorithm.
- **Mapping Persistence:** Mapping decisions are saved to the session on the server, allowing users to resume work later.

### 3.3 The Validation Engine (`processData`)
The core validation logic in `App.tsx` processes every row through multiple layers:
1. **Sanitization:** Normalises LWIN7 codes (max 7 digits), cleans currency symbols, trims whitespace.
2. **Referential Integrity:** Validates Region, Sub-Region, and Country against a geographical reference dataset.
3. **Hierarchy Checking:** Verifies that geographical entities follow a logical parent-child relationship.
4. **Business Rules:** Ensures mandatory fields are present and vintages fall within valid ranges (1900–present or `NV`).
5. **Per-row LWIN logic:** Rows without a valid LWIN7 require Wine Name, Producer, Vintage, Country, and Region as a substitute. Each row is validated independently — files may contain a mix of LWIN and no-LWIN rows.
6. **Duplicate detection:** Each row is fingerprinted based on its data type. Flagged duplicates are surfaced via the comparison modal. For client reserves, a row with a missing account code is excluded from duplicate checking (client cannot be asserted).
7. **Price anomaly detection:** Unit prices are compared against a per-wine median and a global dataset median. Outliers are flagged for review.

### 3.4 Review Queues
Two toolbar buttons appear when flagged rows are present: "Review Duplicates (N)" and "Review Prices (N)". Each steps through every flagged row one at a time in the DuplicateComparisonModal, showing a progress counter and advancing automatically after each keep/remove decision. User decisions on duplicates and price warnings survive a re-validation (Review Changes does not clear them).

### 3.5 AI-Powered Correction Flow
For rows with errors, the **AI Smart Fix** provides automated remediation via `POST /api/system/ai-fix`:
- **Vintage Extraction:** Moves vintages found within title fields into the `vintage` column and cleans the original field.
- **Field Alignment:** Detects and corrects column-shift errors where data is offset.
- **Name Normalisation:** Cleans producer names and strips non-name artefacts.
- **Review Process:** All AI corrections are presented in a Review Modal — users accept or decline individual row changes before persistence.

> **Note:** AI features require `ANTHROPIC_API_KEY` to be set in the environment. The endpoint returns a `503` if the key is absent.

---

## 4. Backend & API Layer
The Python/FastAPI backend (`server.py`) provides a RESTful interface for session management and AI processing.

### Key Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all active sessions |
| `POST` | `/api/sessions` | Create a new session with rows |
| `GET` | `/api/sessions/:id` | Get full session state including all rows |
| `PATCH` | `/api/sessions/:id` | Update session status, fields, or disabled flag |
| `PATCH` | `/api/sessions/:id/rows/:rowIndex` | Update a single row and write audit entry |
| `POST` | `/api/sessions/:id/rows/bulk` | Bulk update multiple rows |
| `DELETE` | `/api/sessions/:id` | Delete a session and all its rows |
| `GET` | `/api/org` | Returns current `organisation_id` — reads `DEV_ORG_ID` in Phase 1, JWT in Phase 2 |
| `POST` | `/api/system/ai-fix` | AI batch data cleaning (requires `ANTHROPIC_API_KEY`) |

---

## 5. Persistence & Reliability

### 5.1 SQL Server Integration
- **Atomicity:** Session creation (inserting thousands of rows) is handled within a single transaction.
- **Resilience:** Data is persisted server-side so users can resume any `in_progress` session after a browser crash or interruption.
- **Auditing:** The `audit_trail` table records field-level changes with before/after values and change type.
- **Performance:** Indexes on `session_id` in both `session_rows` and `audit_trail` ensure fast session loading regardless of data volume.

### 5.2 AI Availability
The AI endpoint returns a structured `503` error when `ANTHROPIC_API_KEY` is not configured, allowing the rest of the application to function normally without AI features.

---

## 6. Security
- **Environment Management:** API keys and database credentials are stored in server-side environment variables (`.env`) and never exposed to the frontend.
- **Windows Authentication:** The SQL Server connection uses Trusted Connection (Windows Auth) — no passwords stored in config.
- **Data Masking:** Sensitive PII is excluded from AI processing prompts while maintaining context for descriptive wine data.
