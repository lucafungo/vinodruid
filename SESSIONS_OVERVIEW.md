# vinoDruid — Project Sessions Overview

Prepared for: Project Manager
Cadence: 1 session per week, 4 hours per session
Total: 24 sessions, approximately 6 months


## What is a session?

A session is a 4-hour work block, roughly once a week. Each one has a specific goal and by the end of it something concrete should be working or done. If a session runs long, the leftover work is well-defined and moves cleanly into the next one. The sequence is deliberate: the app gets finished and tested first, infrastructure comes after.


## Phase 0 — Finish and Test the App (5 sessions) — COMPLETE

Session 1: Purchase Orders, fields and screen
Set up the Purchase Orders data type. Agreed the field list: PO number, supplier, tax status, cost price, selling price, quantities, dates, status fields. Added to the home screen. Done.

Session 2: Purchase Orders, upload and mapping
Upload and column mapping flow built for purchase orders. LWIN/no-LWIN logic applied. Cellar and account code validation wired in. Done.

Session 3: Purchase Orders, validation and export
Full field-level validation for all PO fields. End-to-end test with a real file passed. CSV export confirmed. Session save and resume confirmed. Done.

Session 4: Full test across all data types
Tested all eight data types using the Ashbourne Fine Wines demo files. Eight Excel test files generated covering every validation rule and error scenario. Bugs identified and fixed within the session. Done.

Session 5: Bug fixes and app freeze
All bugs from testing resolved. Key fixes: no-LWIN required fields corrected to match documented rules (Producer, Country, Region — not Wine Type), client reserves duplicate detection fixed for missing account codes, Review Changes no longer clears user decisions on duplicates and price warnings. Per-row delete button added. Duplicate and price review queues added. Download all completed files as ZIP added. App is stable and frozen pending Phase 1.


## Phase 1 — Multi-tenant Database (3 sessions)

Sessions 6 and 7: Multi-tenant database (combined)
Added two new tables to the database: one for organisations and one for users. Added an organisation ID column to every data table (sessions, rows, audit trail, master cellars, master clients) and updated every query in the backend to filter by it. Existing data was automatically assigned to organisation 1. A default organisation is seeded on first startup. Local development works via a DEV_ORG_ID setting in the environment file — change it and restart to switch organisation. To test isolation, insert a second organisation in SQL and switch the env setting; the app shows a completely empty workspace with no data from organisation 1. A SQL utility file was added with diagnostic and maintenance queries.

Session 8: Admin API
Build the backend endpoints an administrator needs to create organisations and manage users. Test everything. Access control is prepared but not enforced yet — that comes in Phase 2.


## Phase 2 — Authentication (3 sessions)

Session 9: Azure Entra ID and backend
Register the app in Azure Entra ID, which is Microsoft's identity platform. Add token validation to the backend so every request is tied to a known user and organisation. A dev bypass stays available for local work.

Session 10: Login screen
Add a "Sign in with Microsoft" page to the frontend. Once logged in, the user's token is automatically attached to every API call. Name and organisation show in the top bar.

Session 11: Roles and admin panel
Enforce the three roles: viewer (read and export only), editor (full import access), admin (plus the admin panel). Add a basic admin page showing who is in the organisation.


## Phase 3 — Azure Deployment (4 sessions)

Session 12: Azure SQL
Create the Azure SQL database. Run the schema migration and seed the regions reference table. Confirm the backend connects and queries work.

Session 13: Backend on Azure
Deploy the Python backend to Azure App Service. Connect it to the database via credentials stored in Key Vault. Confirm the API responds correctly.

Session 14: Frontend on Azure
Deploy the React frontend to Azure Static Web Apps with auto-deploy on code push. Fix routing for the single-page app. Update Entra ID redirect URLs to the live domain and confirm the full app loads.

Session 15: Secrets and hardening
Move all connection strings and secrets into Azure Key Vault. Restrict the API to only accept requests from the frontend domain. Enable Managed Identity so the backend connects to the database without any stored credentials.


## Phase 4 — Testing in Azure (3 sessions)

Session 16: Full end-to-end test
Log in through Entra ID and run through every import type on the live environment. Load master data, run imports, fix errors, export. Check session resume works across different devices.

Session 17: Tenant isolation test
Set up two real organisations. Log in as each and confirm the data is completely separate. Try to access one organisation's data using the other's login and confirm it is blocked.

Session 18: Fix what broke
Work through anything found in Sessions 16 and 17. Include environment-specific issues like slow startup or connection handling under load.


## Phase 5 — Monitoring and Security (2 sessions)

Session 19: Monitoring
Switch on Azure Application Insights for error and performance tracking. Add logging to the backend for imports and failed logins. Set up an alert for repeated API failures.

Session 20: Security check
Go through the security checklist — CORS, token validation, data isolation, secrets, role enforcement. Fix anything that needs attention. The platform is considered live and stable after this session.


## Phase 6 — Operational Runbook (4 sessions)

The goal of this phase is a practical reference document that anyone responsible for running the platform can follow without needing to understand the code. Each session covers one topic: the process is written up and then walked through live to confirm it works exactly as described.

Session 21: Adding a new organisation
Document the full process for onboarding a new client. This means creating the organisation record, setting up their space in the system, and confirming their data is isolated from others. Walk through it with a real example.

Session 22: Creating and managing users
Document how to create a user in Azure Entra ID, assign them to an organisation, and set their role. Cover what to do if a user leaves and how to change a role. Walk through each scenario and confirm it works.

Session 23: Deploying updates
Document the deployment process from a code change on the developer's machine to the live application. Cover what to check before deploying, how to verify it went well, and what to do if something goes wrong. Run through a real deployment to validate the steps.

Session 24: Reading logs and responding to alerts
Document where to find logs, what normal looks like, and how to investigate a reported issue. Cover how the monitoring alert works and what the first steps are when it fires. Walk through a simulated failure to confirm the process is clear. Project is done.


For the full technical breakdown per session, see PLAN.md.
