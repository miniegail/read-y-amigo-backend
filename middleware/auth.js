const jwt = require("jsonwebtoken");
const DeviceSession = require("../models/DeviceSession");

// Verifies the Bearer token and attaches the user's id/role to the request.
// Use this on any route that needs to know who's calling it.
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid authorization header." });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload.id !== "string" || !["teacher", "learner"].includes(payload.role) || payload.type) {
      throw new Error("Invalid session token.");
    }
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }

  if (payload.sid) {
    try {
      const session = await DeviceSession.exists({
        _id: payload.sid,
        user: payload.id,
        expiresAt: { $gt: new Date() },
      });
      if (!session) return res.status(401).json({ error: "Session expired. Please log in again." });
    } catch (error) {
      return next(error);
    }
  }

  req.userId = payload.id;
  req.userRole = payload.role;
  req.sessionId = payload.sid;
  next();
}

// Use after requireAuth to restrict a route to a specific role, e.g.
// router.use(requireAuth, requireRole("teacher"))
function requireRole(role) {
  return (req, res, next) => {
    if (req.userRole !== role) {
      return res.status(403).json({ error: "Not authorized for this action." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };