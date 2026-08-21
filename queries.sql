-- =============================================================================
-- vinoDruid — SQL Utility Queries
-- Database: WineOnboarding @ WOLUCA\SQLEXPRESS
-- =============================================================================


-- =============================================================================
-- USER & ORG MANAGEMENT
-- Run these to set up organisations and users before starting the app.
-- After inserting, update DEV_ORG_ID and DEV_USER_ID in .env accordingly.
-- =============================================================================

-- Add a new organisation
INSERT INTO organisations (name, organisation_type_ref, disabled)
VALUES (N'Wine Owners', N'wine_merchant', 0);
-- Then run this to see the new id:
SELECT TOP 1 organisation_id, name FROM organisations ORDER BY organisation_id DESC;

-- Add a user to an organisation (replace values as needed)
INSERT INTO users (organisation_id, alias, forename, surname, display_name, email, user_access, user_type, disabled)
VALUES (1, N'luca.a', N'Luca', N'Alfieri', N'Luca Alfieri', N'luca.alfieri@wineowners.com', N'admin', N'internal', 0);
-- Then run this to see the new id:
SELECT TOP 1 user_id, display_name, organisation_id FROM users ORDER BY user_id DESC;

-- Verify a user can log in (org active + user active + belongs to org)
SELECT u.user_id, u.display_name, u.user_access, o.name AS org_name
FROM users u
JOIN organisations o ON u.organisation_id = o.organisation_id
WHERE u.user_id = 1 AND u.disabled = 0 AND o.disabled = 0;

-- List all active users per org
SELECT u.user_id, u.display_name, u.alias, u.email, u.user_access,
       o.name AS organisation_name
FROM users u
JOIN organisations o ON u.organisation_id = o.organisation_id
WHERE u.disabled = 0 AND o.disabled = 0
ORDER BY o.organisation_id, u.user_id;

-- Soft-disable a user (they are rejected by /api/me)
UPDATE users SET disabled = 1 WHERE user_id = 1;

-- Re-enable a user
UPDATE users SET disabled = 0 WHERE user_id = 1;

-- Soft-disable an organisation (all its users are rejected by /api/me)
UPDATE organisations SET disabled = 1 WHERE organisation_id = 1;

-- Re-enable an organisation
UPDATE organisations SET disabled = 0 WHERE organisation_id = 1;

-- Hard-delete a user
DELETE FROM users WHERE user_id = 1;

-- Hard-delete an organisation and ALL its data (run in this order)
-- Step 1: clear master data
DELETE FROM master_cellars WHERE organisation_id = 1;
DELETE FROM master_clients WHERE organisation_id = 1;
-- Step 2: delete sessions (cascades to session_rows + audit_trail automatically)
DELETE FROM sessions WHERE organisation_id = 1;
-- Step 3: delete users
DELETE FROM users WHERE organisation_id = 1;
-- Step 4: delete organisation
DELETE FROM organisations WHERE organisation_id = 1;


-- =============================================================================
-- SCHEMA INSPECTION
-- =============================================================================

-- List all tables in the database
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;

-- List all columns for a table (replace 'sessions' with any table name)
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'sessions'
ORDER BY ORDINAL_POSITION;

-- Row counts across all per-org tables
SELECT 'sessions'      AS tbl, COUNT(*) AS rows FROM sessions      UNION ALL
SELECT 'session_rows'  AS tbl, COUNT(*) AS rows FROM session_rows   UNION ALL
SELECT 'audit_trail'   AS tbl, COUNT(*) AS rows FROM audit_trail    UNION ALL
SELECT 'master_cellars'AS tbl, COUNT(*) AS rows FROM master_cellars UNION ALL
SELECT 'master_clients'AS tbl, COUNT(*) AS rows FROM master_clients UNION ALL
SELECT 'organisations' AS tbl, COUNT(*) AS rows FROM organisations  UNION ALL
SELECT 'users'         AS tbl, COUNT(*) AS rows FROM users          UNION ALL
SELECT 'regions'       AS tbl, COUNT(*) AS rows FROM regions;

-- Check indexes
SELECT i.name, t.name AS table_name, i.type_desc, i.is_unique
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
WHERE i.name IS NOT NULL
ORDER BY t.name, i.name;


-- =============================================================================
-- ORGANISATIONS
-- =============================================================================

-- List all organisations
SELECT * FROM organisations ORDER BY organisation_id;

-- Insert a second organisation (for multi-tenancy testing)
INSERT INTO organisations (name, organisation_type_ref, disabled)
VALUES (N'Test Organisation 2', N'wine_merchant', 0);

-- Disable an organisation
UPDATE organisations SET disabled = 1 WHERE organisation_id = 2;


-- =============================================================================
-- USERS
-- =============================================================================

-- List all users with their organisation name
SELECT u.user_id, u.display_name, u.email, u.user_access, u.disabled,
       o.name AS organisation_name
FROM users u
JOIN organisations o ON u.organisation_id = o.organisation_id
ORDER BY u.organisation_id, u.user_id;

-- Insert a test user for org 1
INSERT INTO users (organisation_id, alias, forename, surname, display_name, email, user_access, user_type, disabled)
VALUES (1, N'luca.a', N'Luca', N'Alfieri', N'Luca Alfieri', N'luca.alfieri@wineowners.com', N'admin', N'internal', 0);

-- Insert a test user for org 2 (to test isolation)
INSERT INTO users (organisation_id, alias, forename, surname, display_name, email, user_access, user_type, disabled)
VALUES (2, N'test.user', N'Test', N'User', N'Test User', N'test@testorg.com', N'user', N'client', 0);


-- =============================================================================
-- SESSIONS
-- =============================================================================

-- List all sessions (all orgs, including disabled)
SELECT id, organisation_id, session_type, status, disabled, created_at, updated_at
FROM sessions
ORDER BY created_at DESC;

-- List active sessions for a specific org
SELECT id, session_type, status, created_at, updated_at
FROM sessions
WHERE organisation_id = 1 AND disabled = 0
ORDER BY created_at DESC;

-- View all rows for a specific session (replace 1 with session id)
SELECT row_index, row_content
FROM session_rows
WHERE session_id = 1
ORDER BY row_index;

-- Count rows per session
SELECT s.id, s.session_type, s.status, s.organisation_id, COUNT(r.id) AS row_count
FROM sessions s
LEFT JOIN session_rows r ON s.id = r.session_id
WHERE s.disabled = 0
GROUP BY s.id, s.session_type, s.status, s.organisation_id
ORDER BY s.created_at DESC;


-- =============================================================================
-- AUDIT TRAIL
-- =============================================================================

-- Most recent 50 audit entries
SELECT TOP 50 id, session_id, organisation_id, row_id, field_name,
              old_value, new_value, change_type, created_at
FROM audit_trail
ORDER BY created_at DESC;

-- Audit history for a specific session
SELECT row_id, field_name, old_value, new_value, change_type, created_at
FROM audit_trail
WHERE session_id = 1
ORDER BY created_at DESC;


-- =============================================================================
-- MASTER DATA
-- =============================================================================

-- List cellars per org
SELECT organisation_id, name FROM master_cellars ORDER BY organisation_id, name;

-- List client codes per org
SELECT organisation_id, code FROM master_clients ORDER BY organisation_id, code;


-- =============================================================================
-- REGIONS
-- =============================================================================

-- Total region count (should be 3026)
SELECT COUNT(*) AS total FROM regions;

-- Search regions by name
SELECT * FROM regions WHERE region_name LIKE '%Burgundy%';

-- List all countries
SELECT region_name FROM regions WHERE type = 'Country' ORDER BY region_name;

-- List regions under a country
SELECT region_name, type FROM regions WHERE parent = 'France' ORDER BY type, region_name;


-- =============================================================================
-- MULTI-TENANCY ISOLATION TEST
-- =============================================================================
-- Steps:
--   1. Run start.bat with DEV_ORG_ID=1 in .env, import some data
--   2. Insert org 2 (see above)
--   3. Change DEV_ORG_ID=2 in .env and restart
--   4. The app should show an empty workspace — org 2 has no sessions
--   5. Queries below let you verify data in the DB directly

-- Confirm org 1 data is present but org 2 sees nothing
SELECT organisation_id, COUNT(*) AS sessions FROM sessions GROUP BY organisation_id;
SELECT organisation_id, COUNT(*) AS rows    FROM session_rows GROUP BY organisation_id;
SELECT organisation_id, COUNT(*) AS cellars FROM master_cellars GROUP BY organisation_id;
SELECT organisation_id, COUNT(*) AS clients FROM master_clients GROUP BY organisation_id;


-- =============================================================================
-- MIGRATION — add organisation_id to Phase 0 tables
-- (server.py does this automatically on startup — only run this manually if needed)
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sessions') AND name = 'organisation_id')
    ALTER TABLE sessions ADD organisation_id INT NOT NULL DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('session_rows') AND name = 'organisation_id')
    ALTER TABLE session_rows ADD organisation_id INT NOT NULL DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('audit_trail') AND name = 'organisation_id')
    ALTER TABLE audit_trail ADD organisation_id INT NOT NULL DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('master_cellars') AND name = 'organisation_id')
    ALTER TABLE master_cellars ADD organisation_id INT NOT NULL DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('master_clients') AND name = 'organisation_id')
    ALTER TABLE master_clients ADD organisation_id INT NOT NULL DEFAULT 1;


-- =============================================================================
-- MAINTENANCE
-- =============================================================================

-- Soft-delete all sessions for an org (does not delete rows from DB)
UPDATE sessions SET disabled = 1 WHERE organisation_id = 1;

-- Hard-delete all data for an org (cascade deletes session_rows and audit_trail)
DELETE FROM master_cellars WHERE organisation_id = 1;
DELETE FROM master_clients WHERE organisation_id = 1;
DELETE FROM sessions       WHERE organisation_id = 1;  -- cascades to session_rows + audit_trail

-- Nuclear reset — drops everything (useful on a dev machine to start fresh)
-- Uncomment carefully
-- DROP TABLE IF EXISTS audit_trail;
-- DROP TABLE IF EXISTS session_rows;
-- DROP TABLE IF EXISTS sessions;
-- DROP TABLE IF EXISTS master_cellars;
-- DROP TABLE IF EXISTS master_clients;
-- DROP TABLE IF EXISTS users;
-- DROP TABLE IF EXISTS organisations;
-- DROP TABLE IF EXISTS regions;
