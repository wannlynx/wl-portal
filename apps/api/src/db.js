const { Pool } = require("pg");

function resolveConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.PGHOST || process.env.RAILWAY_TCP_PROXY_DOMAIN;
  const port = process.env.PGPORT || process.env.RAILWAY_TCP_PROXY_PORT || "5432";
  const user = process.env.PGUSER || process.env.POSTGRES_USER;
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
  const database = process.env.PGDATABASE || process.env.POSTGRES_DB;

  if (host && user && password && database) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  }
  return "";
}

const connectionString = resolveConnectionString();
let pool = null;

function hasDbConfig() {
  return !!connectionString;
}

function getPool() {
  if (!hasDbConfig()) {
    throw new Error(
      "Postgres connection is missing. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE."
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function tx(run) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobbers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      oauth_domain TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_jobber_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (user_id, jobber_id)
    );

    CREATE TABLE IF NOT EXISTS user_site_assignments (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL,
      PRIMARY KEY (user_id, site_id)
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      site_code TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      lat DOUBLE PRECISION NOT NULL DEFAULT 0,
      lon DOUBLE PRECISION NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_integrations (
      site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      atg_host TEXT NOT NULL DEFAULT '',
      atg_port INTEGER NOT NULL DEFAULT 10001,
      atg_poll_interval_sec INTEGER NOT NULL DEFAULT 60,
      atg_timeout_sec INTEGER NOT NULL DEFAULT 5,
      atg_retries INTEGER NOT NULL DEFAULT 3,
      atg_stale_sec INTEGER NOT NULL DEFAULT 180,
      pump_timeout_sec INTEGER NOT NULL DEFAULT 5,
      pump_keepalive_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      pump_reconnect_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      pump_stale_sec INTEGER NOT NULL DEFAULT 180
    );

    CREATE TABLE IF NOT EXISTS tanks (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      atg_tank_id TEXT NOT NULL,
      label TEXT NOT NULL,
      product TEXT NOT NULL,
      capacity_liters DOUBLE PRECISION NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS pumps (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      pump_number INTEGER NOT NULL,
      label TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS pump_sides (
      id TEXT PRIMARY KEY,
      pump_id TEXT NOT NULL REFERENCES pumps(id) ON DELETE CASCADE,
      side TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 5201,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS forecourt_layouts (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      json JSONB NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS alarm_events (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      tank_id TEXT,
      pump_id TEXT,
      side TEXT,
      component TEXT NOT NULL,
      severity TEXT NOT NULL,
      state TEXT NOT NULL,
      event_at TIMESTAMPTZ,
      alert_type TEXT,
      alert_type_id INTEGER,
      reported_state TEXT,
      code TEXT,
      message TEXT NOT NULL,
      raw_payload TEXT,
      raised_at TIMESTAMPTZ,
      cleared_at TIMESTAMPTZ,
      ack_at TIMESTAMPTZ,
      ack_by TEXT,
      assigned_to TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tank_measurements (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      tank_id TEXT NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL,
      fuel_volume_l DOUBLE PRECISION NOT NULL,
      fuel_height_mm DOUBLE PRECISION,
      water_height_mm DOUBLE PRECISION,
      temp_c DOUBLE PRECISION,
      ullage_l DOUBLE PRECISION,
      raw_payload TEXT
    );

    CREATE TABLE IF NOT EXISTS atg_inventory_readings (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      tank_id TEXT NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
      facility_name TEXT NOT NULL,
      atg_tank_label TEXT NOT NULL,
      read_at TIMESTAMPTZ NOT NULL,
      tank_capacity DOUBLE PRECISION NOT NULL,
      ullage DOUBLE PRECISION,
      safe_ullage DOUBLE PRECISION,
      volume DOUBLE PRECISION,
      raw_payload TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_status (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      target_id TEXT,
      status TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      details_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL,
      site_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      before_json JSONB,
      after_json JSONB,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  await query(`
    ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT '';
  `);

  await query(`
    ALTER TABLE alarm_events
    ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ;
  `);

  await query(`
    ALTER TABLE alarm_events
    ADD COLUMN IF NOT EXISTS alert_type TEXT;
  `);

  await query(`
    ALTER TABLE alarm_events
    ADD COLUMN IF NOT EXISTS alert_type_id INTEGER;
  `);

  await query(`
    ALTER TABLE alarm_events
    ADD COLUMN IF NOT EXISTS reported_state TEXT;
  `);

  await query(`
    ALTER TABLE jobbers
    ADD COLUMN IF NOT EXISTS logo_url TEXT NOT NULL DEFAULT '';
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS oauth_provider TEXT NOT NULL DEFAULT '';
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS oauth_subject TEXT NOT NULL DEFAULT '';
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
  `);

  await query(`
    ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS jobber_id TEXT REFERENCES jobbers(id);
  `);

  await query(`
    UPDATE sites
    SET jobber_id = COALESCE(
      jobber_id,
      (
        SELECT id
        FROM jobbers
        WHERE org_id = sites.org_id
        ORDER BY created_at ASC
        LIMIT 1
      )
    )
    WHERE jobber_id IS NULL;
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_identity_idx
    ON users(oauth_provider, oauth_subject)
    WHERE oauth_provider <> '' AND oauth_subject <> '';
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS sites_jobber_id_idx
    ON sites(jobber_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_jobber_roles_jobber_idx
    ON user_jobber_roles(jobber_id);
  `);
}

module.exports = {
  hasDbConfig,
  query,
  tx,
  initDb
};
