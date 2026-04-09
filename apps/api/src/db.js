const { Pool } = require("pg");
const TRANSIENT_DB_ERROR_CODES = new Set(["57P01", "57P02", "57P03"]);
const TRANSIENT_DB_ERROR_NAMES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"]);
const TRANSIENT_DB_ERROR_MESSAGES = [
  "terminating connection due to administrator command",
  "connection terminated unexpectedly",
  "server closed the connection unexpectedly",
  "Connection terminated unexpectedly"
];

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

function isTransientDbError(error) {
  if (!error) return false;
  if (TRANSIENT_DB_ERROR_CODES.has(String(error.code || "").trim())) return true;
  if (TRANSIENT_DB_ERROR_NAMES.has(String(error.errno || error.code || "").trim().toUpperCase())) return true;
  const message = String(error.message || "");
  return TRANSIENT_DB_ERROR_MESSAGES.some((fragment) => message.includes(fragment));
}

function resetPool() {
  const current = pool;
  pool = null;
  if (current) {
    current.end().catch(() => {});
  }
}

function createPool() {
  const nextPool = new Pool({
    connectionString,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
  });
  nextPool.on("error", (error) => {
    console.error("[db] pool error", error);
    if (isTransientDbError(error)) {
      resetPool();
    }
  });
  return nextPool;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getPool() {
  if (!hasDbConfig()) {
    throw new Error(
      "Postgres connection is missing. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE."
    );
  }
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

async function withDbRetry(run, { attempts = 2, retryDelayMs = 250 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === attempts) {
        throw error;
      }
      console.warn(`[db] transient database error on attempt ${attempt}; retrying`, error);
      resetPool();
      await delay(retryDelayMs);
    }
  }
  throw lastError;
}

async function query(text, params = []) {
  return withDbRetry(() => getPool().query(text, params));
}

async function tx(run) {
  return withDbRetry(async () => {
    const client = await getPool().connect();
    let releaseAsBroken = false;
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      releaseAsBroken = isTransientDbError(error);
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseAsBroken = true;
        console.error("[db] rollback failed", rollbackError);
      }
      throw error;
    } finally {
      try {
        client.release(releaseAsBroken);
      } catch (releaseError) {
        console.error("[db] client release failed", releaseError);
      }
      if (releaseAsBroken) {
        resetPool();
      }
    }
  });
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

    CREATE TABLE IF NOT EXISTS site_pricing_configs (
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      pricing_key TEXT NOT NULL,
      formula_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      market_label TEXT NOT NULL,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (site_id, pricing_key)
    );

    CREATE TABLE IF NOT EXISTS jobber_pricing_configs (
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      pricing_key TEXT NOT NULL,
      formula_id TEXT NOT NULL,
      fuel_type TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL,
      market_label TEXT NOT NULL,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (jobber_id, pricing_key)
    );

    CREATE TABLE IF NOT EXISTS jobber_secrets (
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (jobber_id, provider)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address_line1 TEXT NOT NULL DEFAULT '',
      address_line2 TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      terminal_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_contacts (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      fax_email TEXT NOT NULL DEFAULT '',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      delivery_method TEXT NOT NULL DEFAULT 'email',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_pricing_profiles (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      effective_start DATE NOT NULL,
      effective_end DATE,
      freight_miles DOUBLE PRECISION,
      freight_cost_gas DOUBLE PRECISION,
      freight_cost_diesel DOUBLE PRECISION,
      rack_margin_gas DOUBLE PRECISION,
      rack_margin_diesel DOUBLE PRECISION,
      discount_regular DOUBLE PRECISION,
      discount_mid DOUBLE PRECISION,
      discount_premium DOUBLE PRECISION,
      discount_diesel DOUBLE PRECISION,
      output_template_id TEXT,
      rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_source_snapshots (
      id TEXT PRIMARY KEY,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      pricing_date DATE NOT NULL,
      source_type TEXT NOT NULL,
      source_label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      created_by TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pricing_source_values (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES pricing_source_snapshots(id) ON DELETE CASCADE,
      market_key TEXT NOT NULL DEFAULT '',
      terminal_key TEXT NOT NULL DEFAULT '',
      product_key TEXT NOT NULL DEFAULT '',
      vendor_key TEXT NOT NULL DEFAULT '',
      quote_code TEXT NOT NULL DEFAULT '',
      value DOUBLE PRECISION,
      unit TEXT NOT NULL DEFAULT '',
      effective_date DATE,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_tax_schedules (
      id TEXT PRIMARY KEY,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      product_family TEXT NOT NULL,
      tax_name TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      effective_start DATE NOT NULL,
      effective_end DATE,
      created_at TIMESTAMPTZ NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_rule_sets (
      id TEXT PRIMARY KEY,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      product_family TEXT NOT NULL,
      effective_start DATE NOT NULL,
      effective_end DATE,
      status TEXT NOT NULL DEFAULT 'draft',
      version_label TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_rule_components (
      id TEXT PRIMARY KEY,
      rule_set_id TEXT NOT NULL REFERENCES pricing_rule_sets(id) ON DELETE CASCADE,
      component_key TEXT NOT NULL,
      label TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT '',
      default_value DOUBLE PRECISION,
      multiplier DOUBLE PRECISION NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_editable BOOLEAN NOT NULL DEFAULT TRUE,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS pricing_rule_vendor_sets (
      id TEXT PRIMARY KEY,
      rule_set_id TEXT NOT NULL REFERENCES pricing_rule_sets(id) ON DELETE CASCADE,
      selection_mode TEXT NOT NULL,
      product_family TEXT NOT NULL,
      market_key TEXT NOT NULL DEFAULT '',
      basis_mode TEXT NOT NULL DEFAULT 'match_rule_vendor',
      vendors_json JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    CREATE TABLE IF NOT EXISTS pricing_export_templates (
      id TEXT PRIMARY KEY,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      channel TEXT NOT NULL,
      template_body TEXT NOT NULL DEFAULT '',
      template_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generated_customer_prices (
      id TEXT PRIMARY KEY,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pricing_date DATE NOT NULL,
      rule_set_id TEXT REFERENCES pricing_rule_sets(id) ON DELETE SET NULL,
      source_snapshot_group_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      regular_base DOUBLE PRECISION,
      mid_base DOUBLE PRECISION,
      premium_base DOUBLE PRECISION,
      diesel_base DOUBLE PRECISION,
      regular_total DOUBLE PRECISION,
      mid_total DOUBLE PRECISION,
      premium_total DOUBLE PRECISION,
      diesel_total DOUBLE PRECISION,
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'generated',
      created_at TIMESTAMPTZ NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_export_jobs (
      id TEXT PRIMARY KEY,
      jobber_id TEXT NOT NULL REFERENCES jobbers(id) ON DELETE CASCADE,
      pricing_date DATE NOT NULL,
      template_id TEXT REFERENCES pricing_export_templates(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'generated',
      requested_by TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      result_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS allied_transactions (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL,
      account_origin TEXT NOT NULL DEFAULT '',
      actual_sales_price DOUBLE PRECISION,
      auth_amount DOUBLE PRECISION,
      card_name TEXT NOT NULL DEFAULT '',
      card_type TEXT NOT NULL DEFAULT '',
      emv_error_code TEXT NOT NULL DEFAULT '',
      emv_status TEXT NOT NULL DEFAULT '',
      emv_tran_type TEXT NOT NULL DEFAULT '',
      entry_method TEXT NOT NULL DEFAULT '',
      exp_date TEXT NOT NULL DEFAULT '',
      fallback_to_msr BOOLEAN NOT NULL DEFAULT FALSE,
      first8 TEXT NOT NULL DEFAULT '',
      fuel_description TEXT NOT NULL DEFAULT '',
      fuel_position_id TEXT NOT NULL DEFAULT '',
      fuel_quantity_gallons DOUBLE PRECISION,
      last4 TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT '',
      store_id TEXT NOT NULL DEFAULT '',
      tag_denial_reason TEXT NOT NULL DEFAULT '',
      timestamp TIMESTAMPTZ NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      total_amount DOUBLE PRECISION,
      raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      UNIQUE(site_id, transaction_id)
    );
  `);

  await query(`
    ALTER TABLE jobber_pricing_configs
    ADD COLUMN IF NOT EXISTS fuel_type TEXT NOT NULL DEFAULT '';
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
    CREATE INDEX IF NOT EXISTS customers_jobber_id_idx
    ON customers(jobber_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS customer_contacts_customer_id_idx
    ON customer_contacts(customer_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS customer_pricing_profiles_customer_id_idx
    ON customer_pricing_profiles(customer_id, effective_start DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_source_snapshots_jobber_date_idx
    ON pricing_source_snapshots(jobber_id, pricing_date DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_source_values_snapshot_id_idx
    ON pricing_source_values(snapshot_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_tax_schedules_jobber_effective_idx
    ON pricing_tax_schedules(jobber_id, effective_start DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_rule_sets_jobber_status_idx
    ON pricing_rule_sets(jobber_id, status, effective_start DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_rule_components_rule_set_id_idx
    ON pricing_rule_components(rule_set_id, sort_order ASC);
  `);

  await query(`
    ALTER TABLE pricing_rule_vendor_sets
    ADD COLUMN IF NOT EXISTS basis_mode TEXT NOT NULL DEFAULT 'match_rule_vendor';
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_rule_vendor_sets_rule_set_id_idx
    ON pricing_rule_vendor_sets(rule_set_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_export_templates_jobber_id_idx
    ON pricing_export_templates(jobber_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS generated_customer_prices_jobber_date_idx
    ON generated_customer_prices(jobber_id, pricing_date DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS generated_customer_prices_customer_id_idx
    ON generated_customer_prices(customer_id, pricing_date DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS pricing_export_jobs_jobber_date_idx
    ON pricing_export_jobs(jobber_id, pricing_date DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_jobber_roles_jobber_idx
    ON user_jobber_roles(jobber_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_store_timestamp_idx
    ON allied_transactions(store_id, "timestamp" DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_store_id_idx
    ON allied_transactions(store_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_emv_status_idx
    ON allied_transactions(emv_status);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_payment_type_idx
    ON allied_transactions(payment_type);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_fuel_position_idx
    ON allied_transactions(fuel_position_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_card_name_idx
    ON allied_transactions(card_name);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_denial_reason_idx
    ON allied_transactions(tag_denial_reason);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_entry_method_idx
    ON allied_transactions(entry_method);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS allied_transactions_emv_tran_type_idx
    ON allied_transactions(emv_tran_type);
  `);
}

module.exports = {
  hasDbConfig,
  query,
  tx,
  initDb
};
