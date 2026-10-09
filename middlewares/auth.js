// middlewares/auth.js  (mise à jour recommandée: backward-compatible)
import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token manquant" });

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ message: "Token invalide" });
  }

  try {
    // un compte désactivé (ou supprimé) perd l'accès immédiatement
    const dbUser = await User.findById(decoded.id).select("isActive");
    if (!dbUser || dbUser.isActive === false) {
      return res.status(401).json({ message: "Compte désactivé" });
    }

    // ✅ backward-compatible: si ancien token = {id, role}
    req.user = {
      id: decoded.id,
      role: decoded.role,
      accountType: decoded.accountType ?? undefined,
      companyId: decoded.companyId ?? null,
    };

    next();
  } catch (e) {
    console.error("Erreur authentification :", e);
    return res.status(500).json({ message: "Erreur d'authentification" });
  }
}
