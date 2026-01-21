// middlewares/requireManager.js
export function requireManager(req, res, next) {
  const role = req.user?.role;
  if (role === "manager" || role === "admin") return next();
  return res.status(403).json({ message: "Accès refusé (manager requis)" });
}
