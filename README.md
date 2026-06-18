# vinoDruid — Wine Data Onboarding Portal

A local ETL tool for cleaning, validating, and onboarding wine trade data from CSV and Excel files into a structured SQL Server database. Designed for wine merchants and trade businesses importing inventory, client reserves, sales orders, purchase orders, cellars, and client lists.

---

## Prerequisites

- **Node.js** 18+
- **Python** 3.12+
- **SQL Server Express** running locally at `WOLUCA\SQLEXPRESS` (Windows Authentication)
- **ODBC Driver 17 or 18 for SQL Server** installed

---

## Running locally

Install frontend dependencies:
```
npm install
```

Install backend dependencies:
```
pip install -r requirements.txt
```

Start both servers together:
```
npm run dev
```

This runs:
- **Vite dev server** at `http://localhost:5173` (frontend)
- **FastAPI backend** at `http://localhost:3000` (API)

The backend creates the `WineOnboarding` database and all required tables automatically on first start. The regions reference table (3,026 entries) lives in the `regions` SQL table.

---

## Supported data types

| Type | Description |
|---|---|
| Inventory | Wine stock held in cellars |
| Client Reserves | Wines allocated to clients |
| Sales Orders | Customer sales transactions |
| Purchase Orders | Supplier purchase transactions |
| Cellars | Physical storage locations |
| Trade Clients | Business account master data |
| Private Clients | Individual client master data |
| Suppliers | Supplier master data |

---

## Workflow

1. **Select data type** on the home screen
2. **Upload** a CSV or Excel (.xlsx) file
3. **Map columns** — the app auto-detects matches between your file's headers and the expected schema fields
4. **Review** — each row is validated and flagged red (errors) or green (clean)
5. **Fix** — open individual rows to correct issues, or use bulk fix options
6. **Export** — download the cleaned data as CSV

---

## Environment

The database connection is configured via environment variables in a `.env` file at the project root:

```
DB_SERVER=WOLUCA\SQLEXPRESS
DB_NAME=WineOnboarding
```

Windows Authentication is used — no username/password required on a local machine.

---

## API

The FastAPI backend exposes a REST API at `http://localhost:3000`. Interactive documentation is available at:
```
http://localhost:3000/docs
```
