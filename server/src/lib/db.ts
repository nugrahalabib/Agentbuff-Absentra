/**
 * SQLite database + schema. Mirrors PRD §10. Every tenant table carries
 * `company_id` and the API layer scopes every query by it (tenant isolation,
 * PRD §4.3 — the server-side equivalent of the RLS + repository guard).
 */
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.ABSENTRA_DB ?? join(__dirname, '..', '..', 'absentra.db')

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  timezone TEXT NOT NULL,
  address TEXT,
  logo_url TEXT,
  workweek_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS membership (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  scope_branch_ids TEXT NOT NULL DEFAULT '[]',
  scope_division_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS branch (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL NOT NULL,
  long REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_branch_company ON branch (company_id);

CREATE TABLE IF NOT EXISTS geofence (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'circle',
  center_lat REAL NOT NULL,
  center_long REAL NOT NULL,
  radius_m REAL NOT NULL,
  buffer_m REAL NOT NULL DEFAULT 50,
  polygon TEXT
);
CREATE INDEX IF NOT EXISTS ix_geofence_company_branch ON geofence (company_id, branch_id);

CREATE TABLE IF NOT EXISTS division (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_division_company ON division (company_id);

CREATE TABLE IF NOT EXISTS employee_profile (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  branch_id TEXT NOT NULL,
  division_id TEXT,
  wage_basic REAL NOT NULL DEFAULT 0,
  wage_fixed_allowance REAL NOT NULL DEFAULT 0,
  wage_variable_allowance REAL NOT NULL DEFAULT 0,
  employment_status TEXT NOT NULL DEFAULT 'active',
  consent_location_at TEXT,
  consent_photo_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_emp_company_branch ON employee_profile (company_id, branch_id);

CREATE TABLE IF NOT EXISTS shift_template (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  crosses_midnight INTEGER NOT NULL DEFAULT 0,
  break_minutes INTEGER NOT NULL DEFAULT 60,
  late_tolerance_minutes INTEGER NOT NULL DEFAULT 10,
  geofence_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_shift_company ON shift_template (company_id);

CREATE TABLE IF NOT EXISTS shift_assignment (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  shift_template_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  UNIQUE (company_id, employee_id, work_date, shift_template_id)
);
CREATE INDEX IF NOT EXISTS ix_assign_company_emp_date ON shift_assignment (company_id, employee_id, work_date);

CREATE TABLE IF NOT EXISTS attendance_record (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  shift_assignment_id TEXT,
  status TEXT NOT NULL,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  trust_score INTEGER NOT NULL DEFAULT 100,
  clock_in_at TEXT,
  clock_out_at TEXT,
  left_early INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS ix_att_company_emp_date ON attendance_record (company_id, employee_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_company_branch_date ON attendance_record (company_id, branch_id, work_date);

CREATE TABLE IF NOT EXISTS attendance_event (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  attendance_record_id TEXT NOT NULL,
  type TEXT NOT NULL,
  event_time_client TEXT,
  event_time_server TEXT NOT NULL,
  lat REAL, long REAL, gps_accuracy REAL,
  ip TEXT, device_fingerprint TEXT,
  photo_data TEXT,
  liveness_passed INTEGER,
  geofence_result TEXT,
  submitted_offline INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS leave_request (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  type TEXT NOT NULL,
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_leave_company ON leave_request (company_id);

CREATE TABLE IF NOT EXISTS overtime_request (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL,
  day_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ot_company ON overtime_request (company_id);

CREATE TABLE IF NOT EXISTS policy (
  company_id TEXT PRIMARY KEY,
  late_deduction_mode TEXT NOT NULL DEFAULT 'per_minute',
  late_deduction_config TEXT NOT NULL DEFAULT '{}',
  meal_allowance_config TEXT NOT NULL DEFAULT '{}',
  strict_geofence INTEGER NOT NULL DEFAULT 0,
  trust_thresholds TEXT NOT NULL DEFAULT '{"accept":80,"review":60}',
  photo_retention_days INTEGER NOT NULL DEFAULT 90
);

CREATE TABLE IF NOT EXISTS mcp_connection (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  oauth_client_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  scope_branch_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS invite (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  division_id TEXT,
  role TEXT NOT NULL DEFAULT 'employee',
  token TEXT UNIQUE NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  wage_basic REAL NOT NULL DEFAULT 0,
  wage_fixed_allowance REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_token (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  company_id TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_bridge (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  issuer TEXT UNIQUE NOT NULL,
  jwks TEXT NOT NULL,
  company_mapping TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS used_jti (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  metadata TEXT,
  source TEXT NOT NULL DEFAULT 'ui',
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_company ON audit_log (company_id, created_at);
`)

// Lightweight migrations for existing databases (SQLite has no "ADD COLUMN IF NOT EXISTS").
for (const stmt of [
  'ALTER TABLE attendance_record ADD COLUMN left_early INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE employee_profile ADD COLUMN photo_data TEXT',
  'ALTER TABLE employee_profile ADD COLUMN leave_balance_annual INTEGER NOT NULL DEFAULT 12',
  'ALTER TABLE attendance_event ADD COLUMN late_submitted INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE attendance_record ADD COLUMN clock_out_at TEXT',
  'ALTER TABLE leave_request ADD COLUMN attachment_name TEXT',
  'ALTER TABLE leave_request ADD COLUMN decided_reason TEXT',
  'ALTER TABLE overtime_request ADD COLUMN decided_reason TEXT',
  'ALTER TABLE overtime_request ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE mcp_connection ADD COLUMN token_hash TEXT',
  'ALTER TABLE policy ADD COLUMN min_rest_hours INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE user ADD COLUMN password_hash TEXT',
]) {
  try { db.exec(stmt) } catch { /* column already exists */ }
}

export function now(): string {
  return new Date().toISOString()
}
