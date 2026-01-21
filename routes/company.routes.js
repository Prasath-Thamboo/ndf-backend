import express from "express";
import { authenticate } from "../middlewares/auth.js";
import { requireManager } from "../middlewares/requireManager.js";
import Company from "../models/company.model.js";
import User from "../models/user.model.js";

const router = express.Router();

/**
 * GET /api/company/me
 * Retourne la société du manager connecté (name + inviteCode)
 */
router.get("/me", authenticate, requireManager, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("accountType companyId role");
    if (!user) return res.status(401).json({ message: "Utilisateur introuvable" });

    if (user.accountType !== "company" || !user.companyId) {
      return res.status(400).json({ message: "Aucune entreprise associée à ce compte" });
    }

    const company = await Company.findById(user.companyId).select("name inviteCode createdBy settings");
    if (!company) return res.status(404).json({ message: "Entreprise introuvable" });

    return res.json({
      id: company._id,
      name: company.name,
      inviteCode: company.inviteCode,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur lors du chargement de l'entreprise" });
  }
});

export default router;
