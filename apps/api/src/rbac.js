function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

function userRoles(user) {
  if (!user) return [];
  const roles = new Set();
  if (user.role) roles.add(user.role);
  if (user.jobberRole) roles.add(user.jobberRole);
  for (const membership of user.jobberMemberships || []) {
    if (membership.role) roles.add(membership.role);
  }
  return Array.from(roles);
}

function canAccessSite(user, siteId) {
  if (!user) return false;
  const roles = userRoles(user);
  if (roles.includes("system_manager")) return true;
  if (roles.includes("admin")) return true;
  if (roles.includes("manager")) return user.siteIds?.includes(siteId);
  if (user.role === "service_tech") return user.siteIds?.includes(siteId);
  if (user.role === "operator") return user.siteIds?.includes(siteId);
  return false;
}

function requireSiteAccess(req, res, next) {
  const siteId = req.params.id || req.params.siteId || req.query.siteId;
  if (!siteId) return res.status(400).json({ error: "Missing siteId" });
  if (!canAccessSite(req.user, siteId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const grantedRoles = userRoles(req.user);
    if (grantedRoles.includes("system_manager")) {
      return next();
    }
    if (grantedRoles.includes("admin")) {
      return next();
    }
    if (!grantedRoles.some((role) => roles.includes(role))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

module.exports = {
  requireAuth,
  requireSiteAccess,
  requireRole,
  canAccessSite,
  userRoles
};
