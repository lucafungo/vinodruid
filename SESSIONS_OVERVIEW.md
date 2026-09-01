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
Added two new tables to the database: one for organisations and one for users. Added an organisation ID column to every data table (sessions, rows, audit trail, master cellars, master clients) and updated every query in the backend to filter by it. Added created by and updated by columns to track which user performed each action. Existing data was automatically assigned to organisation 1. A default organisation is seeded on first startup. Local development works via DEV_ORG_ID and DEV_USER_ID settings in the environment file. On startup the backend validates that both the organisation and the user exist and that the user belongs to that organisation. If either check fails the app shows a clear error screen instead of loading. When everything is valid the header shows a greeting with the user's name and organisation. A SQL utility file was added with queries to create and manage organisations and users, run diagnostic checks, and test data isolation.

Session 8: Admin API and admin panel
Build the backend endpoints an administrator needs to create organisations and manage users: create and list organisations, create and list users, enable or disable either, view all sessions across all organisations, view the audit trail. Build the admin panel UI so an administrator can do all of this from the browser. Access control is prepared but not enforced until Auth0 is live. Done.


## Phase 2 — Authentication (3 sessions)

Session 9: Auth0 and login flow
Set up Auth0 as the identity provider. JWT token validation added to the backend so every request is tied to a known user and organisation by matching the email in the token against the users table. The React app is wrapped in the Auth0 provider with a custom login page matching the app style. An access token is attached automatically to every API call. When an admin creates a user in the admin panel the backend also registers that user in Auth0 via the Management API and returns a 7-day password-setup link the admin can send directly to the new user. A dev bypass stays available via an environment variable. Done.

Session 10: Roles enforcement
Enforce the three access levels on both backend and frontend: viewer (read and export only), editor (full import access), admin (full access including the admin panel). Backend checks the user's access level on each endpoint group. Frontend hides controls the user cannot use.

Session 11: Testing and hardening
End-to-end test of the full auth flow: register a new user in Auth0, log in, confirm the right organisation is loaded, test role restrictions, confirm a token from organisation A cannot access organisation B's data. Fix anything that needs attention.


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
Log in through Auth0 and run through every import type on the live environment. Load master data, run imports, fix errors, export. Check session resume works across different devices.

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
Document how to create a user in Auth0, assign them to an organisation in the admin panel, and set their access level. Cover what to do if a user leaves and how to change a role. Walk through each scenario and confirm it works.

Session 23: Deploying updates
Document the deployment process from a code change on the developer's machine to the live application. Cover what to check before deploying, how to verify it went well, and what to do if something goes wrong. Run through a real deployment to validate the steps.

Session 24: Reading logs and responding to alerts
Document where to find logs, what normal looks like, and how to investigate a reported issue. Cover how the monitoring alert works and what the first steps are when it fires. Walk through a simulated failure to confirm the process is clear. Project is done.


For the full technical breakdown per session, see PLAN.md.
