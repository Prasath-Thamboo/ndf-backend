// routes/expense.routes.js
import express from "express";
import Expense from "../models/expense.model.js";
import User from "../models/user.model.js";
import { authenticate } from "../middlewares/auth.js";
import { requireManager } from "../middlewares/requireManager.js";
import upload from "../middlewares/upload.js";
import fs from "fs";
import path from "path";
import { sendExpenseEmail } from "../services/mail.service.js";
import { logAudit } from "../services/audit.service.js";

const router = express.Router();

/**
 * ===========================
 * CRÉATION MANUELLE (+ justificatif)
 * POST /api/expenses
 * ===========================
 */
router.post("/", authenticate, upload.single("receipt"), async (req, res) => {
  try {
    const { title, amount, date, category, description, userId } = req.body;

    if (!title || !amount || !date) {
      return res.status(400).json({
        message: "Titre, montant et date sont obligatoires",
      });
    }

    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    const receipt = req.file
      ? {
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          path: req.file.path,
          size: req.file.size,
        }
      : null;

    const isSolo = dbUser.accountType === "solo";
    const isCompany = dbUser.accountType === "company";
    const isManager = dbUser.role === "manager" || dbUser.role === "admin";

    // =========================
    // Déterminer le propriétaire
    // =========================
    let targetUserId = req.user.id;

    if (isSolo) {
      targetUserId = req.user.id;
    } else if (isCompany) {
      if (isManager) {
        // ✅ Manager/Admin: DOIT créer pour un employé (jamais pour lui-même)
        const uid = typeof userId === "string" ? userId.trim() : "";
        if (!uid) {
          return res.status(400).json({
            message:
              "En mode entreprise, un manager doit sélectionner un employé.",
          });
        }

        const target = await User.findById(uid).select(
          "_id role accountType companyId isActive"
        );

        if (!target) {
          return res
            .status(404)
            .json({ message: "Utilisateur cible introuvable" });
        }

        if (target.accountType !== "company" || !target.companyId) {
          return res
            .status(400)
            .json({ message: "Utilisateur cible invalide" });
        }

        if (String(target.companyId) !== String(dbUser.companyId)) {
          return res
            .status(403)
            .json({ message: "Utilisateur cible hors entreprise" });
        }

        if (target.role !== "employee") {
          return res.status(400).json({
            message:
              "Le manager ne peut créer des notes que pour des employés.",
          });
        }

        if (target.isActive === false) {
          return res.status(400).json({ message: "Employé désactivé" });
        }

        if (String(target._id) === String(req.user.id)) {
          return res.status(400).json({
            message: "Le manager ne peut pas créer une note pour lui-même.",
          });
        }

        targetUserId = target._id;
      } else {
        // Employee: toujours pour lui-même
        targetUserId = req.user.id;
      }
    }

    // =========================
    // Statut initial
    // =========================
    let initialStatus = "pending";
    let validatedBy = null;
    let validatedAt = null;

    if (isSolo) {
      initialStatus = "approved";
      validatedBy = req.user.id;
      validatedAt = new Date();
    } else if (isCompany && isManager) {
      // ✅ manager crée pour un employé => approved direct
      initialStatus = "approved";
      validatedBy = req.user.id;
      validatedAt = new Date();
    } else {
      initialStatus = "pending";
    }

    const expense = await Expense.create({
      user: targetUserId,
      companyId: dbUser.companyId || null,
      title,
      amount: Number(amount),
      date: new Date(date),
      category,
      description,
      receipt,
      createdByAI: false,
      status: initialStatus,
      validatedBy,
      validatedAt,
      rejectionReason: "",
    });

    // ✅ Audit log: création
    await logAudit({
      req,
      actorId: req.user.id,
      companyId: dbUser.companyId || null,
      action: "expense.created",
      targetType: "expense",
      targetId: expense._id,
      metadata: {
        forUserId: String(targetUserId),
        amount: Number(expense.amount),
        status: expense.status,
        createdByAI: false,
      },
    });

    return res.status(201).json(expense);
  } catch (err) {
    console.error("Erreur création note :", err);
    return res.status(500).json({
      message: "Erreur lors de la création de la note de frais",
    });
  }
});

/**
 * ===========================
 * LISTE DES NOTES
 * GET /api/expenses
 * - solo: ses notes
 * - employee: ses notes
 * - manager: notes de sa company
 * + query optionnelle: ?status=pending|approved|rejected
 * ===========================
 */
router.get("/", authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    let filter = {};

    if (dbUser.accountType === "solo") {
      filter = { user: req.user.id };
    } else {
      if (!dbUser.companyId) {
        filter = { user: req.user.id };
      } else {
        if (dbUser.role === "manager" || dbUser.role === "admin") {
          filter = { companyId: dbUser.companyId };
        } else {
          filter = { user: req.user.id, companyId: dbUser.companyId };
        }
      }
    }

    // filtre optionnel par status via query string
    const { status } = req.query;
    if (status) {
      const allowed = ["pending", "approved", "rejected"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: "Statut invalide" });
      }
      filter.status = status;
    }

    // populate
    let query = Expense.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .populate("validatedBy", "name email");

    if (dbUser.role === "manager" || dbUser.role === "admin") {
      query = query.populate("user", "name email role");
    }

    const expenses = await query;
    return res.json(expenses);
  } catch (err) {
    console.error("Erreur chargement notes :", err);
    return res
      .status(500)
      .json({ message: "Erreur lors du chargement des notes de frais" });
  }
});

/**
 * ===========================
 * LIRE UNE NOTE
 * GET /api/expenses/:id
 * ===========================
 */
router.get("/:id", authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    if (dbUser.accountType === "solo") {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
      return res.json(expense);
    }

    if (!dbUser.companyId) {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
      return res.json(expense);
    }

    if (String(expense.companyId || "") !== String(dbUser.companyId || "")) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    if (dbUser.role === "manager" || dbUser.role === "admin") {
      return res.json(expense);
    }

    if (String(expense.user) !== String(req.user.id)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    return res.json(expense);
  } catch (err) {
    console.error("Erreur lecture note :", err);
    return res
      .status(500)
      .json({ message: "Erreur lors de la lecture de la note de frais" });
  }
});

/**
 * ===========================
 * SUPPRESSION (si pending)
 * DELETE /api/expenses/:id
 * ===========================
 */
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    const status = expense.status ?? "pending";
    if (status !== "pending") {
      return res
        .status(400)
        .json({ message: "Suppression impossible : note non 'pending'" });
    }

    // droits
    if (dbUser.accountType === "solo") {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
      await expense.deleteOne();

      // ✅ Audit log: suppression
      await logAudit({
        req,
        actorId: req.user.id,
        companyId: dbUser.companyId || null,
        action: "expense.deleted",
        targetType: "expense",
        targetId: expense._id,
        metadata: {
          amount: Number(expense.amount) || 0,
          statusBefore: status,
        },
      });

      return res.json({ message: "Note supprimée" });
    }

    if (!dbUser.companyId) {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
      await expense.deleteOne();

      await logAudit({
        req,
        actorId: req.user.id,
        companyId: null,
        action: "expense.deleted",
        targetType: "expense",
        targetId: expense._id,
        metadata: {
          amount: Number(expense.amount) || 0,
          statusBefore: status,
        },
      });

      return res.json({ message: "Note supprimée" });
    }

    if (String(expense.companyId || "") !== String(dbUser.companyId || "")) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // manager/admin peut supprimer pending
    if (dbUser.role === "manager" || dbUser.role === "admin") {
      await expense.deleteOne();

      await logAudit({
        req,
        actorId: req.user.id,
        companyId: dbUser.companyId || null,
        action: "expense.deleted",
        targetType: "expense",
        targetId: expense._id,
        metadata: {
          amount: Number(expense.amount) || 0,
          statusBefore: status,
          deletedByRole: dbUser.role,
        },
      });

      return res.json({ message: "Note supprimée" });
    }

    // employee: uniquement sa note
    if (String(expense.user) !== String(req.user.id)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    await expense.deleteOne();

    await logAudit({
      req,
      actorId: req.user.id,
      companyId: dbUser.companyId || null,
      action: "expense.deleted",
      targetType: "expense",
      targetId: expense._id,
      metadata: {
        amount: Number(expense.amount) || 0,
        statusBefore: status,
      },
    });

    return res.json({ message: "Note supprimée" });
  } catch (err) {
    console.error("Erreur suppression note :", err);
    return res
      .status(500)
      .json({ message: "Erreur lors de la suppression de la note de frais" });
  }
});

/**
 * ===========================
 * VALIDATION (manager)
 * PATCH /api/expenses/:id/approve
 * ===========================
 */
router.patch("/:id/approve", authenticate, requireManager, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    if (dbUser.accountType !== "company" || !dbUser.companyId) {
      return res
        .status(400)
        .json({ message: "Action réservée au mode entreprise" });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    if (!expense.companyId) {
      return res.status(400).json({ message: "Note hors entreprise" });
    }

    if (String(expense.companyId) !== String(dbUser.companyId)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    if (String(expense.user) === String(req.user.id)) {
      return res
        .status(403)
        .json({ message: "Impossible de valider sa propre note" });
    }

    if ((expense.status ?? "pending") !== "pending") {
      return res.status(400).json({ message: "Note déjà traitée" });
    }

    expense.status = "approved";
    expense.validatedBy = req.user.id;
    expense.validatedAt = new Date();
    expense.rejectionReason = "";
    await expense.save();

    // ✅ Audit log: approve
    await logAudit({
      req,
      actorId: req.user.id,
      companyId: dbUser.companyId || null,
      action: "expense.approved",
      targetType: "expense",
      targetId: expense._id,
      metadata: {
        statusBefore: "pending",
        statusAfter: "approved",
      },
    });

    return res.json(expense);
  } catch (err) {
    console.error("Erreur validation note :", err);
    return res.status(500).json({ message: "Erreur lors de la validation" });
  }
});

/**
 * ===========================
 * REFUS (manager)
 * PATCH /api/expenses/:id/reject
 * ===========================
 */
router.patch("/:id/reject", authenticate, requireManager, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    if (dbUser.accountType !== "company" || !dbUser.companyId) {
      return res
        .status(400)
        .json({ message: "Action réservée au mode entreprise" });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    if (!expense.companyId) {
      return res.status(400).json({ message: "Note hors entreprise" });
    }

    if (String(expense.companyId) !== String(dbUser.companyId)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    if (String(expense.user) === String(req.user.id)) {
      return res
        .status(403)
        .json({ message: "Impossible de refuser sa propre note" });
    }

    if ((expense.status ?? "pending") !== "pending") {
      return res.status(400).json({ message: "Note déjà traitée" });
    }

    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    expense.status = "rejected";
    expense.validatedBy = req.user.id;
    expense.validatedAt = new Date();
    expense.rejectionReason = reason;
    await expense.save();

    // ✅ Audit log: reject
    await logAudit({
      req,
      actorId: req.user.id,
      companyId: dbUser.companyId || null,
      action: "expense.rejected",
      targetType: "expense",
      targetId: expense._id,
      metadata: {
        statusBefore: "pending",
        statusAfter: "rejected",
        reason: expense.rejectionReason || "",
      },
    });

    return res.json(expense);
  } catch (err) {
    console.error("Erreur refus note :", err);
    return res.status(500).json({ message: "Erreur lors du refus" });
  }
});

/**
 * ===========================
 * ENVOI PAR EMAIL (BATCH)
 * POST /api/expenses/email
 * ===========================
 */
router.post("/email", authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role email name"
    );
    if (!dbUser) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    const { to, message } = req.body;

    const toStr = typeof to === "string" ? to.trim() : "";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(toStr)) {
      return res.status(400).json({ message: "Email destinataire invalide" });
    }

    let filter = {};

    if (dbUser.accountType === "solo") {
      filter = { user: req.user.id };
    } else {
      const isManager = dbUser.role === "manager" || dbUser.role === "admin";
      if (!isManager) {
        return res.status(403).json({ message: "Action réservée au manager" });
      }
      if (!dbUser.companyId) {
        return res.status(400).json({ message: "Utilisateur sans entreprise" });
      }
      filter = { companyId: dbUser.companyId, status: "approved" };
    }

    const expenses = await Expense.find(filter)
      .populate("user", "name email")
      .sort({ date: -1, createdAt: -1 });

    if (!expenses.length) {
      return res.status(400).json({
        message:
          dbUser.accountType === "solo"
            ? "Aucune note de frais à envoyer."
            : "Aucune note approuvée à envoyer.",
      });
    }

    const ownerLabel =
      dbUser.accountType === "solo"
        ? `Utilisateur: ${dbUser.name || ""}${
            dbUser.email ? ` (${dbUser.email})` : ""
          }`
        : `Entreprise: ${dbUser.companyId}`;

    const subject =
      dbUser.accountType === "solo"
        ? `Notes de frais - ${dbUser.name || dbUser.email || "Utilisateur"}`
        : `Notes de frais approuvées - Export entreprise`;

    const customMsg = typeof message === "string" ? message.trim() : "";

    const lines = [];
    lines.push("Export de notes de frais (envoyé depuis l'application)");
    lines.push(ownerLabel);
    if (customMsg) {
      lines.push("", "Message:", customMsg);
    }

    lines.push("", `Nombre de notes: ${expenses.length}`, "");

    let total = 0;
    for (const e of expenses) {
      const amount = Number(e.amount) || 0;
      total += amount;

      const dateStr = e.date
        ? new Date(e.date).toLocaleDateString("fr-FR")
        : "-";
      const empName = e.user?.name || e.user?.email || "—";

      lines.push(
        `- ${dateStr} | ${e.title} | ${amount.toFixed(2)} € | ${
          e.category || "-"
        } | ${e.status}${dbUser.accountType === "company" ? ` | ${empName}` : ""}`
      );
    }

    lines.push("", `Total: ${total.toFixed(2)} €`);

    const MAX_ATTACHMENTS = 10;
    const attachments = [];

    for (const e of expenses) {
      if (attachments.length >= MAX_ATTACHMENTS) break;

      const receiptPath = e.receipt?.path;
      if (!receiptPath) continue;

      if (!fs.existsSync(receiptPath)) continue;

      attachments.push({
        filename:
          e.receipt.originalName || e.receipt.filename || path.basename(receiptPath),
        path: receiptPath,
        contentType: e.receipt.mimeType,
      });
    }

    if (attachments.length < expenses.filter((e) => e.receipt?.path).length) {
      lines.push(
        "",
        `Note: Justificatifs joints limités à ${MAX_ATTACHMENTS} fichiers.`
      );
    }

    await sendExpenseEmail({
      to: toStr,
      subject,
      text: lines.join("\n"),
      attachments,
    });

    // ✅ Audit log: email batch (log 1 event par note)
    for (const e of expenses) {
      await logAudit({
        req,
        actorId: req.user.id,
        companyId: dbUser.companyId || null,
        action: "expenses.emailed",
        targetType: "expense",
        targetId: e._id,
        metadata: {
          to: toStr,
          scope: dbUser.accountType, // solo | company
        },
      });
    }

    return res.json({
      message: "Email envoyé",
      count: expenses.length,
      attachments: attachments.length,
      total: Number(total.toFixed(2)),
    });
  } catch (err) {
    console.error("Erreur envoi email (batch) :", err);
    return res
      .status(500)
      .json({ message: "Erreur lors de l'envoi de l'email" });
  }
});

export default router;
