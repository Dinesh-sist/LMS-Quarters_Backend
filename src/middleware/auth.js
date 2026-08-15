const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET not set" });

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(...roles) {
  const flattened = roles.flat(Infinity).map((r) => String(r).toLowerCase());
  const allow = new Set(flattened);
  return (req, res, next) => {
    const userRole = String(req.user?.role || "").toLowerCase();
    if (!userRole || !allow.has(userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}



module.exports = { requireAuth, requireRole };
