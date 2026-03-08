const express = require("express");
const cors = require("cors");
const { authMiddleware, encodeToken } = require("./auth");
const { requireAuth, requireSiteAccess, requireRole } = require("./rbac");
const { registerClient, sendEvent, broadcast } = require("./events");
const { query, initDb, hasDbConfig } = require("./db");
const { seedIfEmpty } = require("./seed");

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(authMiddleware);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function siteIdsForUser(user) {
  if (user.role === "manager") {
    const all = await query("SELECT id FROM sites");
    return all.rows.map((r) => r.id);
  }
  return user.siteIds || [];
}

async function ensureSitePermission(user, siteId) {
  const ids = await siteIdsForUser(user);
  return ids.includes(siteId);
}

async function hydrateUserWithSites(userId) {
  const userResult = await query(
    "SELECT id, org_id AS \"orgId\", email, name, role FROM users WHERE id=$1",
    [userId]
  );
  if (userResult.rowCount === 0) return null;
  const sitesResult = await query(
    "SELECT site_id AS \"siteId\" FROM user_site_assignments WHERE user_id=$1",
    [userId]
  );
  return {
    ...userResult.rows[0],
    siteIds: sitesResult.rows.map((r) => r.siteId)
  };
}

async function summariesForSiteIds(ids) {
  if (!ids.length) return [];

  const sites = await query(
    `SELECT
      id,
      site_code AS "siteCode",
      name,
      address,
      postal_code AS "postalCode",
      region,
      lat,
      lon
    FROM sites
    WHERE id = ANY($1::text[])
    ORDER BY site_code`,
    [ids]
  );

  const alerts = await query(
    `SELECT
      site_id AS "siteId",
      COUNT(*) FILTER (WHERE state='raised' AND severity='critical')::int AS "criticalCount",
      COUNT(*) FILTER (WHERE state='raised' AND severity='warn')::int AS "warnCount"
    FROM alarm_events
    WHERE site_id = ANY($1::text[])
    GROUP BY site_id`,
    [ids]
  );

  const connectivity = await query(
    `SELECT
      p.site_id AS "siteId",
      COUNT(ps.id)::int AS "pumpSidesExpected",
      COUNT(ps.id) FILTER (WHERE cs.status='connected')::int AS "pumpSidesConnected"
    FROM pumps p
    JOIN pump_sides ps ON ps.pump_id = p.id
    LEFT JOIN connection_status cs
      ON cs.target_id = ps.id AND cs.kind='pump_side'
    WHERE p.site_id = ANY($1::text[])
    GROUP BY p.site_id`,
    [ids]
  );

  const atg = await query(
    `SELECT site_id AS "siteId", MAX(last_seen_at) AS "atgLastSeenAt"
     FROM connection_status
     WHERE kind='atg' AND site_id = ANY($1::text[])
     GROUP BY site_id`,
    [ids]
  );

  const alertsBySite = new Map(alerts.rows.map((r) => [r.siteId, r]));
  const connBySite = new Map(connectivity.rows.map((r) => [r.siteId, r]));
  const atgBySite = new Map(atg.rows.map((r) => [r.siteId, r]));

  return sites.rows.map((site) => ({
    ...site,
    criticalCount: alertsBySite.get(site.id)?.criticalCount || 0,
    warnCount: alertsBySite.get(site.id)?.warnCount || 0,
    pumpSidesConnected: connBySite.get(site.id)?.pumpSidesConnected || 0,
    pumpSidesExpected: connBySite.get(site.id)?.pumpSidesExpected || 0,
    atgLastSeenAt: atgBySite.get(site.id)?.atgLastSeenAt || null
  }));
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "petroleum-api", dbConfigured: hasDbConfig(), apiVersion: "2026-03-07-tank-info" });
});

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const userResult = await query(
      "SELECT id, org_id AS \"orgId\", email, name, role FROM users WHERE email=$1 AND password=$2",
      [email, password]
    );
    if (userResult.rowCount === 0) return res.status(401).json({ error: "Invalid credentials" });
    const user = userResult.rows[0];
    const siteRows = await query("SELECT site_id AS \"siteId\" FROM user_site_assignments WHERE user_id=$1", [
      user.id
    ]);
    const siteIds = siteRows.rows.map((r) => r.siteId);
    const token = encodeToken({
      userId: user.id,
      role: user.role,
      orgId: user.orgId,
      siteIds
    });
    res.json({
      token,
      user: { ...user, siteIds }
    });
  })
);

app.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await hydrateUserWithSites(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  })
);

app.get(
  "/sites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ids = await siteIdsForUser(req.user);
    const summaries = await summariesForSiteIds(ids);
    res.json(summaries);
  })
);

app.get(
  "/sites/:id",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const summaries = await summariesForSiteIds([req.params.id]);
    if (!summaries.length) return res.status(404).json({ error: "Site not found" });

    const integration = await query(
      `SELECT
        site_id AS "siteId",
        atg_host AS "atgHost",
        atg_port AS "atgPort",
        atg_poll_interval_sec AS "atgPollIntervalSec",
        atg_timeout_sec AS "atgTimeoutSec",
        atg_retries AS "atgRetries",
        atg_stale_sec AS "atgStaleSec",
        pump_timeout_sec AS "pumpTimeoutSec",
        pump_keepalive_enabled AS "pumpKeepaliveEnabled",
        pump_reconnect_enabled AS "pumpReconnectEnabled",
        pump_stale_sec AS "pumpStaleSec"
       FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    const tanks = await query(
      `SELECT
        id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
        capacity_liters AS "capacityLiters", active
      FROM tanks WHERE site_id=$1 ORDER BY atg_tank_id`,
      [req.params.id]
    );
    const pumps = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE site_id=$1 ORDER BY pump_number`,
      [req.params.id]
    );

    res.json({
      ...summaries[0],
      integration: integration.rows[0] || null,
      tanks: tanks.rows,
      pumps: pumps.rows
    });
  })
);

app.post(
  "/sites",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.siteCode || !body.name) {
      return res.status(400).json({ error: "siteCode and name are required" });
    }
    const siteId = `site-${body.siteCode}`;
    const now = new Date().toISOString();

    const exists = await query("SELECT id FROM sites WHERE id=$1", [siteId]);
    if (exists.rowCount > 0) return res.status(400).json({ error: "Site already exists" });

    await query(
      `INSERT INTO sites(
        id, org_id, site_code, name, address, postal_code, region, lat, lon, timezone, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        siteId,
        req.user.orgId,
        body.siteCode,
        body.name,
        body.address || "",
        body.postalCode || "",
        body.region || "",
        Number(body.lat || 0),
        Number(body.lon || 0),
        body.timezone || "America/New_York",
        now,
        now
      ]
    );

    await query(
      `INSERT INTO site_integrations(
        site_id, atg_host, atg_port, atg_poll_interval_sec, atg_timeout_sec, atg_retries, atg_stale_sec,
        pump_timeout_sec, pump_keepalive_enabled, pump_reconnect_enabled, pump_stale_sec
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [siteId, "", 10001, 60, 5, 3, 180, 5, true, true, 180]
    );

    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        siteId,
        "site",
        siteId,
        "create",
        null,
        JSON.stringify({ siteCode: body.siteCode, name: body.name }),
        body.reason || "",
        now
      ]
    );

    const created = await query(
      `SELECT id, site_code AS "siteCode", name, address, postal_code AS "postalCode", region, lat, lon
       FROM sites WHERE id=$1`,
      [siteId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.patch(
  "/sites/:id",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const now = new Date().toISOString();
    const current = await query(
      `SELECT id, name, address, postal_code AS "postalCode", region, lat, lon FROM sites WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Site not found" });
    const before = current.rows[0];
    await query(
      `UPDATE sites SET
        name=$1, address=$2, postal_code=$3, region=$4, lat=$5, lon=$6, updated_at=$7
       WHERE id=$8`,
      [
        body.name ?? before.name,
        body.address ?? before.address,
        body.postalCode ?? before.postalCode,
        body.region ?? before.region,
        body.lat ?? before.lat,
        body.lon ?? before.lon,
        now,
        req.params.id
      ]
    );
    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "site",
        req.params.id,
        "update",
        JSON.stringify(before),
        JSON.stringify({
          name: body.name ?? before.name,
          address: body.address ?? before.address,
          postalCode: body.postalCode ?? before.postalCode,
          region: body.region ?? before.region,
          lat: body.lat ?? before.lat,
          lon: body.lon ?? before.lon
        }),
        body.reason || "",
        now
      ]
    );
    const updated = await query(
      `SELECT id, site_code AS "siteCode", name, address, postal_code AS "postalCode", region, lat, lon
       FROM sites WHERE id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.delete(
  "/sites/:id",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const current = await query(
      `SELECT id, site_code AS "siteCode", name FROM sites WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Site not found" });

    await query("DELETE FROM user_site_assignments WHERE site_id=$1", [req.params.id]);
    await query("DELETE FROM sites WHERE id=$1", [req.params.id]);

    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "site",
        req.params.id,
        "delete",
        JSON.stringify(current.rows[0]),
        null,
        "",
        new Date().toISOString()
      ]
    );

    res.json({ ok: true, deletedSiteId: req.params.id });
  })
);

app.get(
  "/sites/:id/integrations",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const integration = await query(
      `SELECT
        site_id AS "siteId", atg_host AS "atgHost", atg_port AS "atgPort",
        atg_poll_interval_sec AS "atgPollIntervalSec", atg_timeout_sec AS "atgTimeoutSec",
        atg_retries AS "atgRetries", atg_stale_sec AS "atgStaleSec",
        pump_timeout_sec AS "pumpTimeoutSec", pump_keepalive_enabled AS "pumpKeepaliveEnabled",
        pump_reconnect_enabled AS "pumpReconnectEnabled", pump_stale_sec AS "pumpStaleSec"
       FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    res.json(integration.rows[0] || null);
  })
);

app.patch(
  "/sites/:id/integrations",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const now = new Date().toISOString();
    const current = await query(
      `SELECT * FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Integration not found" });
    const c = current.rows[0];
    await query(
      `UPDATE site_integrations SET
        atg_host=$1, atg_port=$2, atg_poll_interval_sec=$3, atg_timeout_sec=$4, atg_retries=$5,
        atg_stale_sec=$6, pump_timeout_sec=$7, pump_keepalive_enabled=$8,
        pump_reconnect_enabled=$9, pump_stale_sec=$10
      WHERE site_id=$11`,
      [
        body.atgHost ?? c.atg_host,
        body.atgPort ?? c.atg_port,
        body.atgPollIntervalSec ?? c.atg_poll_interval_sec,
        body.atgTimeoutSec ?? c.atg_timeout_sec,
        body.atgRetries ?? c.atg_retries,
        body.atgStaleSec ?? c.atg_stale_sec,
        body.pumpTimeoutSec ?? c.pump_timeout_sec,
        body.pumpKeepaliveEnabled ?? c.pump_keepalive_enabled,
        body.pumpReconnectEnabled ?? c.pump_reconnect_enabled,
        body.pumpStaleSec ?? c.pump_stale_sec,
        req.params.id
      ]
    );
    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "site_integrations",
        req.params.id,
        "update",
        JSON.stringify(c),
        JSON.stringify(body),
        body.reason || "",
        now
      ]
    );
    const updated = await query(
      `SELECT
        site_id AS "siteId", atg_host AS "atgHost", atg_port AS "atgPort",
        atg_poll_interval_sec AS "atgPollIntervalSec", atg_timeout_sec AS "atgTimeoutSec",
        atg_retries AS "atgRetries", atg_stale_sec AS "atgStaleSec",
        pump_timeout_sec AS "pumpTimeoutSec", pump_keepalive_enabled AS "pumpKeepaliveEnabled",
        pump_reconnect_enabled AS "pumpReconnectEnabled", pump_stale_sec AS "pumpStaleSec"
       FROM site_integrations WHERE site_id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.get(
  "/sites/:id/pumps",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const pumps = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE site_id=$1 ORDER BY pump_number`,
      [req.params.id]
    );
    const sides = await query(
      `SELECT id, pump_id AS "pumpId", side, ip, port, active
       FROM pump_sides WHERE pump_id = ANY($1::text[])`,
      [pumps.rows.map((p) => p.id)]
    );
    const sidesByPump = new Map();
    for (const side of sides.rows) {
      if (!sidesByPump.has(side.pumpId)) sidesByPump.set(side.pumpId, []);
      sidesByPump.get(side.pumpId).push(side);
    }
    res.json(pumps.rows.map((p) => ({ ...p, sides: sidesByPump.get(p.id) || [] })));
  })
);

app.post(
  "/sites/:id/pumps",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.pumpNumber == null || !body.label) {
      return res.status(400).json({ error: "pumpNumber and label are required" });
    }
    const now = new Date().toISOString();
    const pumpId = `pump-${req.params.id}-${body.pumpNumber}`;
    const exists = await query("SELECT id FROM pumps WHERE id=$1", [pumpId]);
    if (exists.rowCount > 0) return res.status(400).json({ error: "Pump already exists" });

    await query(
      `INSERT INTO pumps(id, site_id, pump_number, label, active) VALUES ($1,$2,$3,$4,$5)`,
      [pumpId, req.params.id, Number(body.pumpNumber), body.label, true]
    );
    for (const side of ["A", "B"]) {
      const cfg = body.sides?.[side] || {};
      await query(
        `INSERT INTO pump_sides(id, pump_id, side, ip, port, active) VALUES ($1,$2,$3,$4,$5,$6)`,
        [`ps-${pumpId}-${side.toLowerCase()}`, pumpId, side, cfg.ip || "", Number(cfg.port || 5201), true]
      );
    }

    await query(
      `INSERT INTO audit_log(
        id, org_id, user_id, site_id, entity_type, entity_id, action, before_json, after_json, reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [
        id("audit"),
        req.user.orgId,
        req.user.userId,
        req.params.id,
        "pump",
        pumpId,
        "create",
        null,
        JSON.stringify({ pumpNumber: body.pumpNumber, label: body.label }),
        body.reason || "",
        now
      ]
    );

    const created = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE id=$1`,
      [pumpId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.patch(
  "/pumps/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const current = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Pump not found" });
    const pump = current.rows[0];
    const allowed = await ensureSitePermission(req.user, pump.siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query(
      `UPDATE pumps SET pump_number=$1, label=$2, active=$3 WHERE id=$4`,
      [
        body.pumpNumber ?? pump.pumpNumber,
        body.label ?? pump.label,
        body.active ?? pump.active,
        req.params.id
      ]
    );

    for (const side of ["A", "B"]) {
      if (!body.sides?.[side]) continue;
      const existing = await query(
        `SELECT id FROM pump_sides WHERE pump_id=$1 AND side=$2`,
        [req.params.id, side]
      );
      if (existing.rowCount > 0) {
        await query(
          `UPDATE pump_sides SET ip=$1, port=$2 WHERE id=$3`,
          [body.sides[side].ip || "", Number(body.sides[side].port || 5201), existing.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO pump_sides(id, pump_id, side, ip, port, active) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id("ps"), req.params.id, side, body.sides[side].ip || "", Number(body.sides[side].port || 5201), true]
        );
      }
    }

    const updated = await query(
      `SELECT id, site_id AS "siteId", pump_number AS "pumpNumber", label, active
       FROM pumps WHERE id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.delete(
  "/pumps/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const current = await query(
      `SELECT id, site_id AS "siteId" FROM pumps WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Pump not found" });
    const allowed = await ensureSitePermission(req.user, current.rows[0].siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query("DELETE FROM pumps WHERE id=$1", [req.params.id]);
    res.json({ ok: true, deletedPumpId: req.params.id });
  })
);

app.get(
  "/sites/:id/tanks",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const tanks = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE site_id=$1 ORDER BY atg_tank_id`,
      [req.params.id]
    );
    res.json(tanks.rows);
  })
);

app.post(
  "/sites/:id/tanks",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.atgTankId || !body.label || !body.product) {
      return res.status(400).json({ error: "atgTankId, label, product are required" });
    }
    const tankId = `tank-${req.params.id}-${body.atgTankId}`;
    await query(
      `INSERT INTO tanks(id, site_id, atg_tank_id, label, product, capacity_liters, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tankId, req.params.id, body.atgTankId, body.label, body.product, Number(body.capacityLiters || 0), true]
    );
    const created = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE id=$1`,
      [tankId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.patch(
  "/tanks/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const current = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Tank not found" });
    const tank = current.rows[0];
    const allowed = await ensureSitePermission(req.user, tank.siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query(
      `UPDATE tanks SET atg_tank_id=$1, label=$2, product=$3, capacity_liters=$4, active=$5 WHERE id=$6`,
      [
        body.atgTankId ?? tank.atgTankId,
        body.label ?? tank.label,
        body.product ?? tank.product,
        body.capacityLiters ?? tank.capacityLiters,
        body.active ?? tank.active,
        req.params.id
      ]
    );
    const updated = await query(
      `SELECT id, site_id AS "siteId", atg_tank_id AS "atgTankId", label, product,
              capacity_liters AS "capacityLiters", active
       FROM tanks WHERE id=$1`,
      [req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.delete(
  "/tanks/:id",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const current = await query(
      `SELECT id, site_id AS "siteId" FROM tanks WHERE id=$1`,
      [req.params.id]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: "Tank not found" });
    const allowed = await ensureSitePermission(req.user, current.rows[0].siteId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await query("DELETE FROM tanks WHERE id=$1", [req.params.id]);
    res.json({ ok: true, deletedTankId: req.params.id });
  })
);

app.get(
  "/sites/:id/layout",
  requireAuth,
  requireSiteAccess,
  asyncHandler(async (req, res) => {
    const layout = await query(
      `SELECT
         id, site_id AS "siteId", version, name, json, created_by AS "createdBy",
         created_at AS "createdAt", is_active AS "isActive"
       FROM forecourt_layouts
       WHERE site_id=$1 AND is_active=TRUE`,
      [req.params.id]
    );
    if (layout.rowCount === 0) return res.status(404).json({ error: "Layout not found" });
    res.json(layout.rows[0]);
  })
);

app.post(
  "/sites/:id/layout",
  requireAuth,
  requireSiteAccess,
  requireRole("manager", "service_tech"),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.json) return res.status(400).json({ error: "json is required" });
    const now = new Date().toISOString();
    const maxVersion = await query(
      `SELECT COALESCE(MAX(version), 0)::int AS version FROM forecourt_layouts WHERE site_id=$1`,
      [req.params.id]
    );
    const nextVersion = maxVersion.rows[0].version + 1;
    const layoutId = `layout-${req.params.id}-v${nextVersion}`;
    await query(`UPDATE forecourt_layouts SET is_active=FALSE WHERE site_id=$1`, [req.params.id]);
    await query(
      `INSERT INTO forecourt_layouts(id, site_id, version, name, json, created_by, created_at, is_active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [
        layoutId,
        req.params.id,
        nextVersion,
        body.name || `Layout v${nextVersion}`,
        JSON.stringify(body.json),
        req.user.userId,
        now,
        true
      ]
    );
    const created = await query(
      `SELECT
         id, site_id AS "siteId", version, name, json, created_by AS "createdBy",
         created_at AS "createdAt", is_active AS "isActive"
       FROM forecourt_layouts WHERE id=$1`,
      [layoutId]
    );
    res.status(201).json(created.rows[0]);
  })
);

app.get(
  "/alerts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { siteId, state, severity, component, pumpId, side } = req.query;
    const userSiteIds = await siteIdsForUser(req.user);
    if (!userSiteIds.length) return res.json([]);

    const conditions = ["site_id = ANY($1::text[])"];
    const params = [userSiteIds];
    let i = 2;
    if (siteId) {
      conditions.push(`site_id = $${i++}`);
      params.push(siteId);
    }
    if (state) {
      conditions.push(`state = $${i++}`);
      params.push(state);
    }
    if (severity) {
      conditions.push(`severity = $${i++}`);
      params.push(severity);
    }
    if (component) {
      conditions.push(`component = $${i++}`);
      params.push(component);
    }
    if (pumpId) {
      conditions.push(`pump_id = $${i++}`);
      params.push(pumpId);
    }
    if (side) {
      conditions.push(`side = $${i++}`);
      params.push(side);
    }

    const result = await query(
      `SELECT
        id, site_id AS "siteId", source_type AS "sourceType", tank_id AS "tankId", pump_id AS "pumpId",
        side, component, severity, state, event_at AS "eventAt", alert_type AS "alertType",
        alert_type_id AS "alertTypeId", reported_state AS "reportedState", code, message, raw_payload AS "rawPayload",
        raised_at AS "raisedAt", cleared_at AS "clearedAt", ack_at AS "ackAt",
        ack_by AS "ackBy", assigned_to AS "assignedTo", created_at AS "createdAt"
       FROM alarm_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 500`,
      params
    );
    res.json(result.rows);
  })
);

app.post(
  "/alerts/:id/ack",
  requireAuth,
  asyncHandler(async (req, res) => {
    const now = new Date().toISOString();
    const userSiteIds = await siteIdsForUser(req.user);
    const target = await query("SELECT id, site_id AS \"siteId\" FROM alarm_events WHERE id=$1", [
      req.params.id
    ]);
    if (target.rowCount === 0) return res.status(404).json({ error: "Alert not found" });
    if (!userSiteIds.includes(target.rows[0].siteId)) return res.status(403).json({ error: "Forbidden" });

    const updated = await query(
      `UPDATE alarm_events
       SET state='acknowledged', ack_at=$1, ack_by=$2
       WHERE id=$3
       RETURNING
         id, site_id AS "siteId", source_type AS "sourceType", tank_id AS "tankId", pump_id AS "pumpId",
         side, component, severity, state, event_at AS "eventAt", alert_type AS "alertType",
         alert_type_id AS "alertTypeId", reported_state AS "reportedState", code, message, raw_payload AS "rawPayload",
         raised_at AS "raisedAt", cleared_at AS "clearedAt", ack_at AS "ackAt",
         ack_by AS "ackBy", assigned_to AS "assignedTo", created_at AS "createdAt"`,
      [now, req.user.userId, req.params.id]
    );
    res.json(updated.rows[0]);
  })
);

app.get(
  "/history/tanks",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { siteId, tankId, from, to, limit } = req.query;
    const userSiteIds = await siteIdsForUser(req.user);
    if (!userSiteIds.length) return res.json([]);
    const conditions = ["site_id = ANY($1::text[])"];
    const params = [userSiteIds];
    let i = 2;
    if (siteId) {
      conditions.push(`site_id = $${i++}`);
      params.push(siteId);
    }
    if (tankId) {
      conditions.push(`tank_id = $${i++}`);
      params.push(tankId);
    }
    if (from) {
      conditions.push(`ts >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`ts <= $${i++}`);
      params.push(to);
    }
    const rowLimit = Math.min(10000, Math.max(100, Number(limit) || (tankId ? 2500 : 6000)));
    const rows = await query(
      `SELECT
         id, site_id AS "siteId", tank_id AS "tankId", ts, fuel_volume_l AS "fuelVolumeL",
         fuel_height_mm AS "fuelHeightMm", water_height_mm AS "waterHeightMm",
         temp_c AS "tempC", ullage_l AS "ullageL", raw_payload AS "rawPayload"
       FROM tank_measurements
       WHERE ${conditions.join(" AND ")}
       ORDER BY ts DESC
       LIMIT ${rowLimit}`,
      params
    );
    res.json(rows.rows);
  })
);


app.get(
  "/tank-information",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { siteId, tankId, product, from, to, refillOnly, limit } = req.query;
    const userSiteIds = await siteIdsForUser(req.user);
    if (!userSiteIds.length) return res.json([]);

    const conditions = ["r.site_id = ANY($1::text[])"];
    const params = [userSiteIds];
    let i = 2;

    if (siteId) {
      conditions.push(`r.site_id = $${i++}`);
      params.push(siteId);
    }
    if (tankId) {
      conditions.push(`r.tank_id = $${i++}`);
      params.push(tankId);
    }
    if (product) {
      conditions.push(`t.product = $${i++}`);
      params.push(product);
    }
    if (from) {
      conditions.push(`r.read_at >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`r.read_at <= $${i++}`);
      params.push(to);
    }
    if (refillOnly === "true") {
      conditions.push("COALESCE(r.raw_payload::jsonb->>'event', 'drawdown') = 'delivery'");
    }

    const rowLimit = Math.min(10000, Math.max(100, Number(limit) || (tankId ? 2500 : 6000)));
    const result = await query(
      `WITH filtered AS (
        SELECT
          r.id,
          r.site_id AS "siteId",
          r.tank_id AS "tankId",
          s.site_code AS "siteCode",
          s.name AS "siteName",
          r.facility_name AS "facilityName",
          t.atg_tank_id AS "atgTankId",
          t.label AS "tankLabel",
          t.product,
          r.read_at AS "readAt",
          r.tank_capacity AS "tankCapacity",
          r.ullage,
          r.safe_ullage AS "safeUllage",
          r.volume,
          r.raw_payload AS "rawPayload"
        FROM atg_inventory_readings r
        JOIN sites s ON s.id = r.site_id
        JOIN tanks t ON t.id = r.tank_id
        WHERE ${conditions.join(" AND ")}
      ), ranked AS (
        SELECT
          filtered.*,
          LAG(volume) OVER (PARTITION BY "tankId" ORDER BY "readAt") AS "previousVolume"
        FROM filtered
      )
      SELECT
        id,
        "siteId",
        "tankId",
        "siteCode",
        "siteName",
        "facilityName",
        "atgTankId",
        "tankLabel",
        product,
        "readAt",
        "tankCapacity",
        ullage,
        "safeUllage",
        volume,
        ROUND((CASE WHEN "tankCapacity" > 0 THEN (volume / "tankCapacity") * 100 ELSE 0 END)::numeric, 1) AS "fillPercent",
        ROUND((volume - COALESCE("previousVolume", volume))::numeric, 2) AS "deltaVolume",
        COALESCE("rawPayload"::jsonb->>'event', 'drawdown') AS "eventType"
      FROM ranked
      ORDER BY "readAt" DESC
      LIMIT ${rowLimit}`,
      params
    );

    res.json(result.rows);
  })
);
app.get("/events", requireAuth, (req, res) => {
  const channels = (req.query.channels || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache"
  });
  res.write("\n");
  const cleanup = registerClient(res, channels);
  sendEvent(res, "connected", { ok: true, ts: new Date().toISOString() });
  req.on("close", cleanup);
});

app.get(
  "/audit",
  requireAuth,
  requireRole("manager", "service_tech"),
  asyncHandler(async (_req, res) => {
    const rowLimit = Math.min(10000, Math.max(100, Number(limit) || (tankId ? 2500 : 6000)));
    const rows = await query(
      `SELECT
        id, org_id AS "orgId", user_id AS "userId", site_id AS "siteId",
        entity_type AS "entityType", entity_id AS "entityId", action,
        before_json AS "beforeJson", after_json AS "afterJson", reason, created_at AS "createdAt"
       FROM audit_log ORDER BY created_at DESC LIMIT 300`
    );
    res.json(rows.rows);
  })
);

async function runSimulatorTick() {
  const now = new Date().toISOString();
  const sites = await query("SELECT id FROM sites");
  for (const site of sites.rows) {
    broadcast("site:update", {
      channel: `site:${site.id}:alerts`,
      siteId: site.id,
      ts: now
    });
  }
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error", detail: error.message });
});

async function start() {
  let dbReady = false;
  if (!hasDbConfig()) {
    console.error(
      "Postgres connection is missing. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE."
    );
  } else {
    await initDb();
    const seeded = await seedIfEmpty();
    if (seeded) {
      console.log("Database was empty; sample seed data inserted.");
    }
    dbReady = true;
  }

  if (dbReady) {
    setInterval(() => {
      runSimulatorTick().catch((error) => console.error("Simulator tick error:", error.message));
    }, 5000);
  }

  app.listen(port, () => {
    console.log(`petroleum-api listening on ${port} (dbReady=${dbReady})`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});








