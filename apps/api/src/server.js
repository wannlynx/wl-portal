const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { authMiddleware, encodeToken } = require("./auth");
const { requireAuth, requireSiteAccess, requireRole } = require("./rbac");
const { registerClient, sendEvent, broadcast } = require("./events");
const { query, initDb, hasDbConfig } = require("./db");
const { seedIfEmpty } = require("./seed");

const app = express();
const port = Number(process.env.PORT || 4000);
const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:5173";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(authMiddleware);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const EIA_LEAFHANDLER_URLS = {
  wti: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=D&n=PET&s=RWTC",
  brent: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=D&n=PET&s=RBRTE",
  gasoline: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=EMM_EPM0_PTE_NUS_DPG",
  diesel: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=EMD_EPD2D_PTE_NUS_DPG",
  crudeStocks: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=WCESTUS1",
  gasolineStocks: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=WGTSTUS1",
  distillateStocks: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=WDISTUS1"
};

const EIA_RETAIL_REGIONS = [
  { key: "NUS", label: "U.S." },
  { key: "R10", label: "East Coast" },
  { key: "R20", label: "Midwest" },
  { key: "R30", label: "Gulf Coast" },
  { key: "R40", label: "Rocky Mountain" },
  { key: "R50", label: "West Coast" }
];

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11
};

function normalizeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseLeafRows(html) {
  const rows = [];
  const regex = /<tr>\s*<td class='B6'>([\s\S]*?)<\/td>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    rows.push({
      label: normalizeHtml(match[1]).replace(/^\s+/, ""),
      cells: [...match[2].matchAll(/<td class='B[35]'>([\s\S]*?)<\/td>/gi)].map((cell) => normalizeHtml(cell[1]))
    });
  }
  return rows;
}

function parseDailyLeafPage(html) {
  return parseLeafRows(html).flatMap((row) => {
    const labelMatch = row.label.match(/^(\d{4})\s+([A-Za-z]{3})-\s*(\d{1,2})\s+to\s+([A-Za-z]{3})-\s*(\d{1,2})$/);
    if (!labelMatch) return [];

    const startYear = Number(labelMatch[1]);
    const startMonth = MONTHS[labelMatch[2]];
    const endMonth = MONTHS[labelMatch[4]];
    const startDay = Number(labelMatch[3]);
    const endDay = Number(labelMatch[5]);
    const endYear = endMonth < startMonth ? startYear + 1 : startYear;
    const startDate = new Date(Date.UTC(startYear, startMonth, startDay));
    const endDate = new Date(Date.UTC(endYear, endMonth, endDay));
    const points = [];

    for (let i = 0; i < row.cells.length; i += 1) {
      const value = row.cells[i];
      const pointDate = new Date(startDate);
      pointDate.setUTCDate(startDate.getUTCDate() + i);
      if (pointDate > endDate || !value) continue;
      points.push({
        date: formatIsoDate(pointDate),
        value: Number(String(value).replace(/,/g, ""))
      });
    }
    return points;
  });
}

function parseWeeklyLeafPage(html) {
  return parseLeafRows(html).flatMap((row) => {
    const labelMatch = row.label.match(/^(\d{4})-([A-Za-z]{3})$/);
    if (!labelMatch) return [];
    const year = Number(labelMatch[1]);

    const points = [];
    for (let i = 0; i < row.cells.length; i += 2) {
      const dateText = row.cells[i];
      const valueText = row.cells[i + 1];
      if (!dateText || !valueText) continue;
      const dateMatch = dateText.match(/^(\d{2})\/(\d{2})$/);
      if (!dateMatch) continue;
      points.push({
        date: formatIsoDate(new Date(Date.UTC(year, Number(dateMatch[1]) - 1, Number(dateMatch[2])))),
        value: Number(String(valueText).replace(/,/g, ""))
      });
    }
    return points;
  });
}

async function fetchLeafSeries(url, parser) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "PetroleumDashboard/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`EIA request failed (${response.status}) for ${url}`);
  }
  const html = await response.text();
  return parser(html);
}

function latestPoints(points, limit) {
  return [...points]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-limit);
}

function benchmarkFromSeries({ key, label, unit, points }) {
  const sorted = latestPoints(points, 400);
  const current = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2] || current;
  const priorWeek = sorted[Math.max(0, sorted.length - 6)] || prior;
  return {
    key,
    label,
    unit,
    current: current.value,
    dayAgo: prior.value,
    weekAgo: priorWeek.value,
    sparkline: latestPoints(points, 7).map((point) => point.value),
    historyAnchors: sorted.map((point) => ({ date: point.date, value: point.value }))
  };
}

function inventorySeriesFromPoints({ key, label, points }) {
  return {
    key,
    label,
    unit: "MMbbl",
    points: latestPoints(points, 60).map((point) => ({
      date: point.date,
      value: Number((point.value / 1000).toFixed(1))
    })),
    annotations: []
  };
}

function retailSeriesUrl(code, regionKey) {
  return `https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=${code}_${regionKey}_DPG`;
}

async function regionalRetailSnapshot({ key, label, code }) {
  const regionSeries = await Promise.all(
    EIA_RETAIL_REGIONS.map(async (region) => {
      const points = await fetchLeafSeries(retailSeriesUrl(code, region.key), parseWeeklyLeafPage);
      const snapshot = benchmarkFromSeries({
        key,
        label,
        unit: "USD/gal",
        points
      });
      return [region.key, {
        label: region.label,
        current: snapshot.current,
        dayAgo: snapshot.dayAgo,
        weekAgo: snapshot.weekAgo,
        sparkline: snapshot.sparkline,
        historyAnchors: latestPoints(points, 7).map((point) => ({ date: point.date, value: point.value }))
      }];
    })
  );

  const national = regionSeries.find(([regionKey]) => regionKey === "NUS");
  const nationalPoints = national?.[1]?.historyAnchors || [];
  return {
    ...(national ? {
      key,
      label,
      unit: "USD/gal",
      current: national[1].current,
      dayAgo: national[1].dayAgo,
      weekAgo: national[1].weekAgo,
      sparkline: national[1].sparkline,
      historyAnchors: nationalPoints
    } : {}),
    regionalSeries: Object.fromEntries(regionSeries),
    defaultRegion: "NUS"
  };
}

async function livePricingSnapshot() {
  const [
    wtiPoints,
    brentPoints,
    gasolinePoints,
    regularRetail,
    midgradeRetail,
    premiumRetail,
    dieselRetail,
    crudeStockPoints,
    gasolineStockPoints,
    distillateStockPoints
  ] = await Promise.all([
    fetchLeafSeries(EIA_LEAFHANDLER_URLS.wti, parseDailyLeafPage),
    fetchLeafSeries(EIA_LEAFHANDLER_URLS.brent, parseDailyLeafPage),
    fetchLeafSeries(EIA_LEAFHANDLER_URLS.gasoline, parseWeeklyLeafPage),
    regionalRetailSnapshot({ key: "regular", label: "Regular Gasoline", code: "EMM_EPMR_PTE" }),
    regionalRetailSnapshot({ key: "midgrade", label: "Midgrade Gasoline", code: "EMM_EPMM_PTE" }),
    regionalRetailSnapshot({ key: "premium", label: "Premium Gasoline", code: "EMM_EPMP_PTE" }),
    regionalRetailSnapshot({ key: "diesel", label: "Diesel", code: "EMD_EPD2D_PTE" }),
    fetchLeafSeries(EIA_LEAFHANDLER_URLS.crudeStocks, parseWeeklyLeafPage),
    fetchLeafSeries(EIA_LEAFHANDLER_URLS.gasolineStocks, parseWeeklyLeafPage),
    fetchLeafSeries(EIA_LEAFHANDLER_URLS.distillateStocks, parseWeeklyLeafPage)
  ]);

  return {
    lastUpdated: new Date().toISOString(),
    benchmarkSnapshots: [
        benchmarkFromSeries({ key: "wti", label: "WTI Crude", unit: "USD/bbl", points: wtiPoints }),
        benchmarkFromSeries({ key: "brent", label: "Brent Crude", unit: "USD/bbl", points: brentPoints }),
        benchmarkFromSeries({ key: "gasoline", label: "RBOB Gasoline", unit: "USD/gal", points: gasolinePoints }),
        regularRetail,
        midgradeRetail,
        premiumRetail,
        dieselRetail
      ],
    inventorySeries: [
      inventorySeriesFromPoints({ key: "crude", label: "Crude Stocks", points: crudeStockPoints }),
      inventorySeriesFromPoints({ key: "gasoline", label: "Gasoline Stocks", points: gasolineStockPoints }),
      inventorySeriesFromPoints({ key: "distillate", label: "Distillate Stocks", points: distillateStockPoints })
    ]
  };
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const oauthProviders = {
  google: {
    key: "google",
    label: "Google",
    clientId: process.env.OAUTH_GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || "",
    callbackUrl: process.env.OAUTH_GOOGLE_CALLBACK_URL || "",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile"
  }
};

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseBase64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function providerConfig(name) {
  const provider = oauthProviders[name];
  if (!provider) return null;
  if (!provider.clientId || !provider.clientSecret || !provider.callbackUrl) return null;
  return provider;
}

function publicProviderInfo(name) {
  const provider = oauthProviders[name];
  return {
    key: provider.key,
    label: provider.label,
    enabled: !!providerConfig(name)
  };
}

function oauthState(provider, redirectTo) {
  return base64UrlJson({
    provider,
    redirectTo: redirectTo || `${webBaseUrl}/auth/callback`,
    nonce: crypto.randomBytes(12).toString("hex"),
    ts: Date.now()
  });
}

function appendParams(target, params, hash = false) {
  const url = new URL(target);
  const search = hash ? new URLSearchParams(url.hash.replace(/^#/, "")) : url.searchParams;
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    search.set(key, String(value));
  }
  if (hash) {
    url.hash = search.toString();
  }
  return url.toString();
}

function redirectWithError(res, redirectTo, error) {
  res.redirect(appendParams(redirectTo || `${webBaseUrl}/auth/callback`, { error }, true));
}

async function exchangeCodeForTokens(provider, code) {
  const body = new URLSearchParams({
    code,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    redirect_uri: provider.callbackUrl,
    grant_type: "authorization_code"
  });
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OAuth token exchange failed: ${detail}`);
  }
  return response.json();
}

async function fetchUserInfo(provider, accessToken) {
  const response = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OAuth userinfo fetch failed: ${detail}`);
  }
  return response.json();
}

function emailDomain(email) {
  const parts = String(email || "").toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

async function membershipsForUser(userId) {
  const membershipResult = await query(
    `SELECT
      ujr.jobber_id AS "jobberId",
      ujr.role,
      ujr.is_default AS "isDefault",
      j.name AS "jobberName",
      j.slug AS "jobberSlug"
     FROM user_jobber_roles ujr
     JOIN jobbers j ON j.id = ujr.jobber_id
     WHERE ujr.user_id=$1
     ORDER BY ujr.is_default DESC, j.name ASC`,
    [userId]
  );
  return membershipResult.rows;
}

function defaultMembership(memberships) {
  if (!memberships.length) return null;
  return memberships.find((membership) => membership.isDefault) || memberships[0];
}

async function currentJobberForUser(user) {
  if (!user?.jobberId) return null;
  const result = await query(
    `SELECT
      id,
      org_id AS "orgId",
      name,
      slug,
      oauth_domain AS "oauthDomain",
      logo_url AS "logoUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM jobbers
     WHERE id=$1`,
    [user.jobberId]
  );
  return result.rows[0] || null;
}

async function sitesForJobber(jobberId) {
  const siteRows = await query(
    `SELECT
      id,
      site_code AS "siteCode",
      name,
      address,
      region
     FROM sites
     WHERE jobber_id=$1
     ORDER BY site_code`,
    [jobberId]
  );
  return siteRows.rows;
}

async function usersForJobber(jobberId) {
  const [userRows, assignmentRows] = await Promise.all([
    query(
      `SELECT
        u.id,
        u.name,
        u.email,
        ujr.role,
        ujr.is_default AS "isDefault"
       FROM user_jobber_roles ujr
       JOIN users u ON u.id = ujr.user_id
       WHERE ujr.jobber_id=$1
       ORDER BY ujr.role, u.name`,
      [jobberId]
    ),
    query(
      `SELECT usa.user_id AS "userId", usa.site_id AS "siteId"
       FROM user_site_assignments usa
       JOIN user_jobber_roles ujr ON ujr.user_id = usa.user_id
       WHERE ujr.jobber_id=$1`,
      [jobberId]
    )
  ]);

  const siteIdsByUser = new Map();
  for (const row of assignmentRows.rows) {
    if (!siteIdsByUser.has(row.userId)) siteIdsByUser.set(row.userId, []);
    siteIdsByUser.get(row.userId).push(row.siteId);
  }

  return userRows.rows.map((row) => ({
    ...row,
    siteIds: siteIdsByUser.get(row.id) || []
  }));
}

async function allJobbers() {
  const result = await query(
    `SELECT
      id,
      org_id AS "orgId",
      name,
      slug,
      oauth_domain AS "oauthDomain",
      logo_url AS "logoUrl",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
     FROM jobbers
     ORDER BY name`
  );
  return result.rows;
}

async function allSitesWithJobbers() {
  const result = await query(
    `SELECT
      s.id,
      s.jobber_id AS "jobberId",
      j.name AS "jobberName",
      s.site_code AS "siteCode",
      s.name,
      s.address,
      s.region
     FROM sites s
     JOIN jobbers j ON j.id = s.jobber_id
     ORDER BY j.name, s.site_code`
  );
  return result.rows;
}

async function allManagedUsers() {
  const [userRows, assignmentRows] = await Promise.all([
    query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role AS "systemRole",
        ujr.jobber_id AS "jobberId",
        j.name AS "jobberName",
        ujr.role,
        ujr.is_default AS "isDefault"
       FROM users u
       LEFT JOIN user_jobber_roles ujr ON ujr.user_id = u.id
       LEFT JOIN jobbers j ON j.id = ujr.jobber_id
       WHERE u.role <> 'system_manager'
       ORDER BY COALESCE(j.name, ''), u.name`
    ),
    query(`SELECT user_id AS "userId", site_id AS "siteId" FROM user_site_assignments`)
  ]);

  const siteIdsByUser = new Map();
  for (const row of assignmentRows.rows) {
    if (!siteIdsByUser.has(row.userId)) siteIdsByUser.set(row.userId, []);
    siteIdsByUser.get(row.userId).push(row.siteId);
  }

  return userRows.rows.map((row) => ({
    ...row,
    siteIds: siteIdsByUser.get(row.id) || []
  }));
}

async function managementOverviewForJobber(jobberId) {
  const [jobber, sites, users] = await Promise.all([
    currentJobberForUser({ jobberId }),
    sitesForJobber(jobberId),
    usersForJobber(jobberId)
  ]);
  return { jobber, sites, users };
}

function requireJobberAdmin(req, res, next) {
  if (req.user.role === "system_manager") {
    return next();
  }
  if (req.user.jobberRole !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

function normalizeManagedRole(value) {
  return value === "admin" || value === "manager" ? value : "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "jobber";
}

async function ensureManagedUserInJobber(jobberId, userId) {
  const result = await query(
    `SELECT
      u.id,
      u.name,
      u.email,
      ujr.role,
      ujr.is_default AS "isDefault"
     FROM users u
     JOIN user_jobber_roles ujr ON ujr.user_id = u.id
     WHERE ujr.jobber_id=$1 AND u.id=$2`,
    [jobberId, userId]
  );
  return result.rows[0] || null;
}

async function managementOverviewForUser(user) {
  if (user.role === "system_manager") {
    const [jobbers, sites, users] = await Promise.all([
      allJobbers(),
      allSitesWithJobbers(),
      allManagedUsers()
    ]);
    return {
      scope: "system",
      jobbers,
      sites,
      users
    };
  }

  const scoped = await managementOverviewForJobber(user.jobberId);
  return {
    scope: "jobber",
    jobbers: scoped.jobber ? [scoped.jobber] : [],
    sites: scoped.sites,
    users: scoped.users,
    jobber: scoped.jobber
  };
}

async function findJobberByEmailDomain(email) {
  const domain = emailDomain(email);
  if (!domain) return null;
  const result = await query(
    `SELECT id, org_id AS "orgId", name, slug, oauth_domain AS "oauthDomain"
     FROM jobbers
     WHERE LOWER(oauth_domain)=$1
     LIMIT 1`,
    [domain]
  );
  return result.rows[0] || null;
}

async function siteIdsForUser(user) {
  if (user.role === "system_manager") {
    const all = await query("SELECT id FROM sites");
    return all.rows.map((r) => r.id);
  }
  if (user.jobberRole === "admin") {
    const all = await query(`SELECT id FROM sites WHERE jobber_id=$1`, [user.jobberId]);
    return all.rows.map((r) => r.id);
  }
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
    `SELECT
      id,
      org_id AS "orgId",
      email,
      name,
      role,
      oauth_provider AS "oauthProvider",
      oauth_subject AS "oauthSubject",
      last_login_at AS "lastLoginAt"
     FROM users
     WHERE id=$1`,
    [userId]
  );
  if (userResult.rowCount === 0) return null;
  const sitesResult = await query(
    "SELECT site_id AS \"siteId\" FROM user_site_assignments WHERE user_id=$1",
    [userId]
  );
  const memberships = await membershipsForUser(userId);
  const selectedMembership = defaultMembership(memberships);
  return {
    ...userResult.rows[0],
    jobberId: selectedMembership?.jobberId || null,
    jobberRole: selectedMembership?.role || null,
    jobberMemberships: memberships,
    siteIds: sitesResult.rows.map((r) => r.siteId)
  };
}

async function authPayloadForUser(userId) {
  const user = await hydrateUserWithSites(userId);
  if (!user) return null;
  return {
    token: encodeToken({
      userId: user.id,
      role: user.role,
      orgId: user.orgId,
      jobberId: user.jobberId,
      jobberRole: user.jobberRole,
      jobberMemberships: user.jobberMemberships,
      siteIds: user.siteIds
    }),
    user
  };
}

async function provisionOauthUser({ providerKey, profile }) {
  const oauthSubject = String(profile.sub || "").trim();
  const email = String(profile.email || "").trim().toLowerCase();
  if (!oauthSubject || !email) {
    throw new Error("OAuth profile is missing subject or email");
  }

  const existingBySubject = await query(
    `SELECT id
     FROM users
     WHERE oauth_provider=$1 AND oauth_subject=$2`,
    [providerKey, oauthSubject]
  );
  if (existingBySubject.rowCount > 0) {
    const userId = existingBySubject.rows[0].id;
    await query(
      `UPDATE users
       SET email=$1, name=$2, last_login_at=$3
       WHERE id=$4`,
      [email, profile.name || email, new Date().toISOString(), userId]
    );
    return userId;
  }

  const existingByEmail = await query(
    `SELECT id
     FROM users
     WHERE LOWER(email)=$1
     LIMIT 1`,
    [email]
  );
  if (existingByEmail.rowCount > 0) {
    const userId = existingByEmail.rows[0].id;
    await query(
      `UPDATE users
       SET oauth_provider=$1, oauth_subject=$2, name=$3, last_login_at=$4
       WHERE id=$5`,
      [providerKey, oauthSubject, profile.name || email, new Date().toISOString(), userId]
    );
    return userId;
  }

  const matchedJobber = await findJobberByEmailDomain(email);
  if (!matchedJobber) {
    throw new Error("No jobber is configured for this email domain");
  }

  const userId = id("user");
  const now = new Date().toISOString();
  const defaultPassword = crypto.randomBytes(24).toString("hex");

  await tx(async (client) => {
    await client.query(
      `INSERT INTO users(
        id, org_id, email, name, role, password, oauth_provider, oauth_subject, last_login_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        userId,
        matchedJobber.orgId,
        email,
        profile.name || email,
        "operator",
        defaultPassword,
        providerKey,
        oauthSubject,
        now
      ]
    );
    await client.query(
      `INSERT INTO user_jobber_roles(user_id, jobber_id, role, is_default, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, matchedJobber.id, "manager", true, now, now]
    );
  });

  return userId;
}

async function summariesForSiteIds(ids) {
  if (!ids.length) return [];

  const sites = await query(
    `SELECT
      id,
      jobber_id AS "jobberId",
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

app.get(
  "/market/pricing",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const snapshot = await livePricingSnapshot();
    res.json(snapshot);
  })
);

app.get("/auth/oauth/providers", (_req, res) => {
  res.json(Object.keys(oauthProviders).map(publicProviderInfo));
});

app.get(
  "/auth/oauth/:provider/start",
  asyncHandler(async (req, res) => {
    const provider = providerConfig(req.params.provider);
    if (!provider) {
      return res.status(400).json({ error: "OAuth provider is not configured" });
    }
    const authorizeUrl = new URL(provider.authorizeUrl);
    authorizeUrl.searchParams.set("client_id", provider.clientId);
    authorizeUrl.searchParams.set("redirect_uri", provider.callbackUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", provider.scope);
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "select_account");
    authorizeUrl.searchParams.set("state", oauthState(provider.key, req.query.redirectTo));
    res.redirect(authorizeUrl.toString());
  })
);

app.get(
  "/auth/oauth/:provider/callback",
  asyncHandler(async (req, res) => {
    const provider = providerConfig(req.params.provider);
    const state = parseBase64UrlJson(req.query.state);
    const redirectTo = state?.redirectTo || `${webBaseUrl}/auth/callback`;

    if (!provider || state?.provider !== req.params.provider) {
      return redirectWithError(res, redirectTo, "oauth_provider_mismatch");
    }
    if (!req.query.code) {
      return redirectWithError(res, redirectTo, req.query.error || "oauth_code_missing");
    }
    if (typeof state.ts !== "number" || Date.now() - state.ts > 10 * 60 * 1000) {
      return redirectWithError(res, redirectTo, "oauth_state_expired");
    }

    try {
      const tokens = await exchangeCodeForTokens(provider, req.query.code);
      const profile = await fetchUserInfo(provider, tokens.access_token);
      const userId = await provisionOauthUser({ providerKey: provider.key, profile });
      const authData = await authPayloadForUser(userId);
      if (!authData) {
        return redirectWithError(res, redirectTo, "oauth_user_not_found");
      }
      res.redirect(
        appendParams(
          redirectTo,
          {
            token: authData.token,
            provider: provider.key
          },
          true
        )
      );
    } catch (error) {
      console.error("OAuth callback failed:", error.message);
      return redirectWithError(res, redirectTo, "oauth_login_failed");
    }
  })
);

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const userResult = await query(
      `SELECT
        id,
        org_id AS "orgId",
        email,
        name,
        role,
        oauth_provider AS "oauthProvider",
        oauth_subject AS "oauthSubject",
        last_login_at AS "lastLoginAt"
       FROM users
       WHERE email=$1 AND password=$2`,
      [email, password]
    );
    if (userResult.rowCount === 0) return res.status(401).json({ error: "Invalid credentials" });
    const user = userResult.rows[0];
    const siteRows = await query("SELECT site_id AS \"siteId\" FROM user_site_assignments WHERE user_id=$1", [
      user.id
    ]);
    const memberships = await membershipsForUser(user.id);
    const selectedMembership = defaultMembership(memberships);
    const siteIds = siteRows.rows.map((r) => r.siteId);
    await query("UPDATE users SET last_login_at=$1 WHERE id=$2", [new Date().toISOString(), user.id]);
    res.json({
      token: encodeToken({
        userId: user.id,
        role: user.role,
        orgId: user.orgId,
        jobberId: selectedMembership?.jobberId || null,
        jobberRole: selectedMembership?.role || null,
        jobberMemberships: memberships,
        siteIds
      }),
      user: {
        ...user,
        jobberId: selectedMembership?.jobberId || null,
        jobberRole: selectedMembership?.role || null,
        jobberMemberships: memberships,
        siteIds
      }
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
  "/jobber",
  requireAuth,
  asyncHandler(async (req, res) => {
    const jobber = await currentJobberForUser(req.user);
    if (!jobber) return res.status(404).json({ error: "Jobber not found" });
    res.json(jobber);
  })
);

app.patch(
  "/jobber",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!req.user.jobberId) return res.status(400).json({ error: "No jobber selected" });
    const body = req.body || {};
    const current = await currentJobberForUser(req.user);
    if (!current) return res.status(404).json({ error: "Jobber not found" });

    await query(
      `UPDATE jobbers
       SET name=$1, logo_url=$2, updated_at=$3
       WHERE id=$4`,
      [
        body.name?.trim() || current.name,
        typeof body.logoUrl === "string" ? body.logoUrl.trim() : current.logoUrl,
        new Date().toISOString(),
        req.user.jobberId
      ]
    );

    const updated = await currentJobberForUser(req.user);
    res.json(updated);
  })
);

app.get(
  "/management/overview",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const overview = await managementOverviewForUser(req.user);
    if (overview.scope === "jobber" && !overview.jobber) return res.status(404).json({ error: "Jobber not found" });
    res.json(overview);
  })
);

app.post(
  "/management/users",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const role = normalizeManagedRole(body.role);
    const targetJobberId = req.user.role === "system_manager" ? String(body.jobberId || "").trim() : req.user.jobberId;
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "").trim();
    const siteIds = Array.isArray(body.siteIds) ? [...new Set(body.siteIds.map(String))] : [];

    if (!name || !email || !password || !role || !targetJobberId) {
      return res.status(400).json({ error: "name, email, password, role, and jobberId are required" });
    }

    const allowedSites = await sitesForJobber(targetJobberId);
    const allowedSiteIds = new Set(allowedSites.map((site) => site.id));
    if (siteIds.some((siteId) => !allowedSiteIds.has(siteId))) {
      return res.status(400).json({ error: "One or more site assignments are outside this jobber" });
    }

    const existingEmail = await query(
      `SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1`,
      [email]
    );
    if (existingEmail.rowCount > 0) {
      return res.status(400).json({ error: "A user with that email already exists" });
    }

    const userId = id("user");
    const now = new Date().toISOString();

    await tx(async (client) => {
      await client.query(
        `INSERT INTO users(id, org_id, email, name, role, password, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userId, req.user.orgId, email, name, "operator", password, null]
      );
      await client.query(
        `INSERT INTO user_jobber_roles(user_id, jobber_id, role, is_default, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, targetJobberId, role, true, now, now]
      );
      for (const siteId of siteIds) {
        await client.query(
          `INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)`,
          [userId, siteId]
        );
      }
    });

    const overview = await managementOverviewForUser(req.user);
    res.status(201).json(overview);
  })
);

app.patch(
  "/management/users/:id",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const currentMemberships = await membershipsForUser(req.params.id);
    const currentMembership = defaultMembership(currentMemberships);
    if (!currentMembership) return res.status(404).json({ error: "Managed user not found" });
    if (req.user.role !== "system_manager" && currentMembership.jobberId !== req.user.jobberId) {
      return res.status(404).json({ error: "Managed user not found" });
    }

    const managedUser = req.user.role === "system_manager"
      ? (await allManagedUsers()).find((user) => user.id === req.params.id)
      : await ensureManagedUserInJobber(req.user.jobberId, req.params.id);
    if (!managedUser) return res.status(404).json({ error: "Managed user not found" });

    const body = req.body || {};
    const role = body.role == null ? managedUser.role : normalizeManagedRole(body.role);
    const targetJobberId = req.user.role === "system_manager"
      ? String(body.jobberId || currentMembership.jobberId || "").trim()
      : req.user.jobberId;
    const email = body.email == null ? managedUser.email : String(body.email).trim().toLowerCase();
    const name = body.name == null ? managedUser.name : String(body.name).trim();
    const password = body.password == null ? "" : String(body.password).trim();
    const siteIds = Array.isArray(body.siteIds) ? [...new Set(body.siteIds.map(String))] : null;

    if (!name || !email || !role || !targetJobberId) {
      return res.status(400).json({ error: "name, email, role, and jobberId are required" });
    }

    const existingEmail = await query(
      `SELECT id FROM users WHERE LOWER(email)=$1 AND id<>$2 LIMIT 1`,
      [email, req.params.id]
    );
    if (existingEmail.rowCount > 0) {
      return res.status(400).json({ error: "A user with that email already exists" });
    }

    const allowedSites = await sitesForJobber(targetJobberId);
    const allowedSiteIds = new Set(allowedSites.map((site) => site.id));
    if (siteIds && siteIds.some((siteId) => !allowedSiteIds.has(siteId))) {
      return res.status(400).json({ error: "One or more site assignments are outside this jobber" });
    }

    await tx(async (client) => {
      if (password) {
        await client.query(
          `UPDATE users SET name=$1, email=$2, password=$3 WHERE id=$4`,
          [name, email, password, req.params.id]
        );
      } else {
        await client.query(
          `UPDATE users SET name=$1, email=$2 WHERE id=$3`,
          [name, email, req.params.id]
        );
      }

      await client.query(
        `UPDATE user_jobber_roles
         SET jobber_id=$1, role=$2, updated_at=$3
         WHERE user_id=$4 AND jobber_id=$5`,
        [targetJobberId, role, new Date().toISOString(), req.params.id, currentMembership.jobberId]
      );

      if (siteIds) {
        await client.query(`DELETE FROM user_site_assignments WHERE user_id=$1`, [req.params.id]);
        for (const siteId of siteIds) {
          await client.query(
            `INSERT INTO user_site_assignments(user_id, site_id) VALUES ($1,$2)`,
            [req.params.id, siteId]
          );
        }
      }
    });

    const overview = await managementOverviewForUser(req.user);
    res.json(overview);
  })
);

app.delete(
  "/management/users/:id",
  requireAuth,
  requireJobberAdmin,
  asyncHandler(async (req, res) => {
    const currentMemberships = await membershipsForUser(req.params.id);
    const currentMembership = defaultMembership(currentMemberships);
    if (!currentMembership) return res.status(404).json({ error: "Managed user not found" });
    if (req.user.role !== "system_manager" && currentMembership.jobberId !== req.user.jobberId) {
      return res.status(404).json({ error: "Managed user not found" });
    }
    if (req.user.userId === req.params.id) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    await tx(async (client) => {
      await client.query(`DELETE FROM user_site_assignments WHERE user_id=$1`, [req.params.id]);
      await client.query(`DELETE FROM user_jobber_roles WHERE user_id=$1`, [req.params.id]);
      await client.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    });

    const overview = await managementOverviewForUser(req.user);
    res.json(overview);
  })
);

app.post(
  "/management/jobbers",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "system_manager") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const body = req.body || {};
    const jobberName = String(body.jobberName || "").trim();
    const oauthDomain = String(body.oauthDomain || "").trim().toLowerCase();
    const adminName = String(body.adminName || "").trim();
    const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
    const adminPassword = String(body.adminPassword || "").trim();
    const logoUrl = String(body.logoUrl || "").trim();

    if (!jobberName || !adminName || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: "jobberName, adminName, adminEmail, and adminPassword are required" });
    }

    const jobberId = id("jobber");
    const slug = slugify(jobberName);
    const adminUserId = id("user");
    const now = new Date().toISOString();

    const existingSlug = await query(`SELECT id FROM jobbers WHERE slug=$1 LIMIT 1`, [slug]);
    if (existingSlug.rowCount > 0) {
      return res.status(400).json({ error: "A jobber with a matching name already exists" });
    }

    const existingEmail = await query(`SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1`, [adminEmail]);
    if (existingEmail.rowCount > 0) {
      return res.status(400).json({ error: "A user with that email already exists" });
    }

    await tx(async (client) => {
      await client.query(
        `INSERT INTO jobbers(id, org_id, name, slug, oauth_domain, logo_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [jobberId, req.user.orgId, jobberName, slug, oauthDomain, logoUrl, now, now]
      );
      await client.query(
        `INSERT INTO users(id, org_id, email, name, role, password, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [adminUserId, req.user.orgId, adminEmail, adminName, "operator", adminPassword, null]
      );
      await client.query(
        `INSERT INTO user_jobber_roles(user_id, jobber_id, role, is_default, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [adminUserId, jobberId, "admin", true, now, now]
      );
    });

    const overview = await managementOverviewForUser(req.user);
    res.status(201).json(overview);
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
        id, org_id, jobber_id, site_code, name, address, postal_code, region, lat, lon, timezone, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        siteId,
        req.user.orgId,
        req.user.jobberId,
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








