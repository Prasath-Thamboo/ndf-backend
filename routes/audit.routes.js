// routes/audit.routes.js
import express from "express";
import { authenticate } from "../middlewares/auth.js";
import AuditLog from "../models/auditLog.model.js";
import Expense from "../models/expense.model.js";
import User from "../models/user.model.js";

const router = express.Router();

/**
 * GET /api/audit/expenses/:id
 * Timeline d'audit d'une note
 */
router.get("/expenses/:id", authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser) return res.status(401).json({ message: "Utilisateur introuvable" });

    const expense = await Expense.findById(req.params.id).select(
      "user companyId"
    );
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    // mêmes règles d'accès que lecture d'une note
    if (dbUser.accountType === "solo") {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
    } else {
      if (!dbUser.companyId) {
        if (String(expense.user) !== String(req.user.id)) {
          return res.status(403).json({ message: "Accès refusé" });
        }
      } else {
        if (String(expense.companyId || "") !== String(dbUser.companyId || "")) {
          return res.status(403).json({ message: "Accès refusé" });
        }

        const isManager = dbUser.role === "manager" || dbUser.role === "admin";
        if (!isManager && String(expense.user) !== String(req.user.id)) {
          return res.status(403).json({ message: "Accès refusé" });
        }
      }
    }

    const logs = await AuditLog.find({
      targetType: "expense",
      targetId: expense._id,
    })
      .populate("actor", "name email role")
      .sort({ createdAt: 1 }); // chronologique

    return res.json(logs);
  } catch (err) {
    console.error("Erreur audit timeline:", err);
    return res.status(500).json({ message: "Erreur lors du chargement de l'audit" });
  }
});

export default router;
