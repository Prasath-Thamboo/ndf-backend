// middlewares/requireAdmin.js
// Réservé au super-administrateur du site (role "admin").
// À utiliser après authenticate (qui lit le rôle en base).
export function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ message: "Accès refusé (administrateur requis)" });
}
