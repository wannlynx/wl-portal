function encodeToken(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function defaultMembership(memberships) {
  if (!Array.isArray(memberships) || memberships.length === 0) return null;
  return memberships.find((membership) => membership?.isDefault) || memberships[0];
}

function decodeToken(token) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const payload = JSON.parse(decoded);
    if (payload && !payload.jobberId) {
      const membership = defaultMembership(payload.jobberMemberships);
      if (membership?.jobberId) {
        payload.jobberId = membership.jobberId;
      }
      if (!payload.jobberRole && membership?.role) {
        payload.jobberRole = membership.role;
      }
    }
    return payload;
  } catch (err) {
    return null;
  }
}

function authMiddleware(req, _res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }
  const token = auth.slice("Bearer ".length);
  req.user = decodeToken(token);
  return next();
}

module.exports = {
  encodeToken,
  decodeToken,
  authMiddleware
};
