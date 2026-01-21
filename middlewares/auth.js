// middlewares/auth.js  (mise à jour recommandée: backward-compatible)
import jwt from "jsonwebtoken";

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token manquant" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ backward-compatible: si ancien token = {id, role}
    req.user = {
      id: decoded.id,
      role: decoded.role,
      accountType: decoded.accountType ?? undefined,
      companyId: decoded.companyId ?? null,
    };

    next();
  } catch (e) {
    return res.status(401).json({ message: "Token invalide" });
  }
}
