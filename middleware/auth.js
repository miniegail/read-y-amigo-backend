const jwt = require("jsonwebtoken");

// Verifies the Bearer token and attaches the user's id/role to the request.
// Use this on any route that needs to know who's calling it.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid authorization header." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.id;
    req.userRole = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
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