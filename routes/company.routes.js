import express from "express";
import Company from "../models/company.model.js";
import User from "../models/user.model.js";
import { authenticate } from "../middlewares/auth.js";
import { requireManager } from "../middlewares/requireManager.js";

const router = express.Router();

/**
 * GET /api/company/me
 * Renvoie la company du user (manager/employee) + inviteCode si manager
 */
router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("companyId role accountType");
    if (!user) return res.status(401).json({ message: "Utilisateur introuvable" });

    if (user.accountType !== "company" || !user.companyId) {
      return res.status(400).json({ message: "Compte non rattaché à une entreprise" });
    }

    const company = await Company.findById(user.companyId).select("name inviteCode createdBy");
    if (!company) return res.status(404).json({ message: "Entreprise introuvable" });

    const canSeeInvite = user.role === "manager" || user.role === "admin";

    return res.json({
      id: company._id,
      name: company.name,
      inviteCode: canSeeInvite ? company.inviteCode : null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur chargement entreprise" });
  }
});

/**
 * GET /api/company/employees
 * Liste des employés (et manager) de la company — manager only
 */
router.get("/employees", authenticate, requireManager, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("companyId accountType role");
    if (!user) return res.status(401).json({ message: "Utilisateur introuvable" });

    if (user.accountType !== "company" || !user.companyId) {
      return res.status(400).json({ message: "Action réservée au mode entreprise" });
    }

    const employees = await User.find({ companyId: user.companyId })
      .select("name email role isActive createdAt")
      .sort({ role: 1, createdAt: -1 });

    return res.json(employees);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur chargement employés" });
  }
});

/**
 * PATCH /api/company/employees/:id
 * Activer/Désactiver un employé — manager only
 * body: { isActive: boolean }
 */
router.patch("/employees/:id", authenticate, requireManager, async (req, res) => {
  try {
    const manager = await User.findById(req.user.id).select("companyId accountType role");
    if (!manager) return res.status(401).json({ message: "Utilisateur introuvable" });

    if (manager.accountType !== "company" || !manager.companyId) {
      return res.status(400).json({ message: "Action réservée au mode entreprise" });
    }

    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive doit être un boolean" });
    }

    const target = await User.findById(req.params.id).select("companyId role isActive");
    if (!target) return res.status(404).json({ message: "Employé introuvable" });

    if (String(target.companyId || "") !== String(manager.companyId || "")) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // on empêche de désactiver un manager/admin via cette route
    if (target.role !== "employee") {
      return res.status(400).json({ message: "Action autorisée uniquement sur un employé" });
    }

    target.isActive = isActive;
    await target.save();

    return res.json({ ok: true, userId: target._id, isActive: target.isActive });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur mise à jour employé" });
  }
});

/**
 * POST /api/company/invite/regenerate
 * Régénère un nouveau code (manager only)
 */
router.post("/invite/regenerate", authenticate, requireManager, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("companyId accountType");
    if (!user) return res.status(401).json({ message: "Utilisateur introuvable" });

    if (user.accountType !== "company" || !user.companyId) {
      return res.status(400).json({ message: "Action réservée au mode entreprise" });
    }

    const company = await Company.findById(user.companyId);
    if (!company) return res.status(404).json({ message: "Entreprise introuvable" });

    company.inviteCode = await createUniqueInviteCode();
    await company.save();

    return res.json({ inviteCode: company.inviteCode });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur regeneration code" });
  }
});

export default router;

// ----- helpers -----
function generateInviteCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function createUniqueInviteCode() {
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode(6);
    const exists = await Company.findOne({ inviteCode: code });
    if (!exists) return code;
  }
  throw new Error("Impossible de générer un code unique");
}
