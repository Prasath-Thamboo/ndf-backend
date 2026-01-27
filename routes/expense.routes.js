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


const router = express.Router();

/**
 * ===========================
 * CRÉATION MANUELLE (+ justificatif)
 * POST /api/expenses
 * ===========================
 */
router.post("/", authenticate, upload.single("receipt"), async (req, res) => {
  try {
    const { title, amount, date, category, description } = req.body;

    if (!title || !amount || !date) {
      return res.status(400).json({
        message: "Titre, montant et date sont obligatoires",
      });
    }

    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser)
      return res.status(401).json({ message: "Utilisateur introuvable" });

    const receipt = req.file
      ? {
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          path: req.file.path,
          size: req.file.size,
        }
      : null;

    // ✅ Règle: solo = auto-approve
    const isSolo = dbUser.accountType === "solo";
    const initialStatus = isSolo ? "approved" : "pending";

    const expense = await Expense.create({
      user: req.user.id,
      companyId: dbUser.companyId || null,
      title,
      amount: Number(amount),
      date: new Date(date),
      category,
      description,
      receipt,
      createdByAI: false,
      status: initialStatus,
      validatedBy: isSolo ? req.user.id : null,
      validatedAt: isSolo ? new Date() : null,
      rejectionReason: "",
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
    if (!dbUser)
      return res.status(401).json({ message: "Utilisateur introuvable" });

    let filter = {};

    // ✅ SOLO : toujours OK
    if (dbUser.accountType === "solo") {
      filter = { user: req.user.id };
    } else {
      // ✅ COMPANY : si companyId absent => fallback (évite 400)
      if (!dbUser.companyId) {
        // fallback sécurisé : on ne montre que ses notes
        filter = { user: req.user.id };
      } else {
        if (dbUser.role === "manager" || dbUser.role === "admin") {
          filter = { companyId: dbUser.companyId };
        } else {
          filter = { user: req.user.id, companyId: dbUser.companyId };
        }
      }
    }

    // ✅ filtre optionnel par status via query string
    const { status } = req.query;
    if (status) {
      const allowed = ["pending", "approved", "rejected"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: "Statut invalide" });
      }
      filter.status = status;
    }

    // ✅ populate user uniquement pour manager/admin (utile pour ManagerDashboard)
    let query = Expense.find(filter).sort({ date: -1, createdAt: -1 });
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
 * - employee/solo: uniquement si owner
 * - manager: si même company
 * ===========================
 */
router.get("/:id", authenticate, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser)
      return res.status(401).json({ message: "Utilisateur introuvable" });

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    if (dbUser.accountType === "solo") {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
      return res.json(expense);
    }

    // company: si user n’a pas de companyId, on retombe sur ownership uniquement
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
    if (!dbUser)
      return res.status(401).json({ message: "Utilisateur introuvable" });

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    const status = expense.status ?? "pending";
    if (status !== "pending") {
      return res
        .status(400)
        .json({ message: "Suppression impossible : note non 'pending'" });
    }

    if (dbUser.accountType === "solo") {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
      await expense.deleteOne();
      return res.json({ message: "Note supprimée" });
    }

    // company: si user n’a pas de companyId -> ownership only
    if (!dbUser.companyId) {
      if (String(expense.user) !== String(req.user.id)) {
        return res.status(403).json({ message: "Accès refusé" });
      }
      await expense.deleteOne();
      return res.json({ message: "Note supprimée" });
    }

    if (String(expense.companyId || "") !== String(dbUser.companyId || "")) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    if (dbUser.role === "manager" || dbUser.role === "admin") {
      await expense.deleteOne();
      return res.json({ message: "Note supprimée" });
    }

    if (String(expense.user) !== String(req.user.id)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    await expense.deleteOne();
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
    if (!dbUser)
      return res.status(401).json({ message: "Utilisateur introuvable" });

    if (dbUser.accountType !== "company" || !dbUser.companyId) {
      return res
        .status(400)
        .json({ message: "Action réservée au mode entreprise" });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    // ✅ défense : refuse toute note hors entreprise
    if (!expense.companyId) {
      return res.status(400).json({ message: "Note hors entreprise" });
    }

    // ✅ même company obligatoire
    if (String(expense.companyId) !== String(dbUser.companyId)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // ✅ option métier recommandée : empêcher auto-validation
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
 * body: { reason?: string }
 * ===========================
 */
router.patch("/:id/reject", authenticate, requireManager, async (req, res) => {
  try {
    const dbUser = await User.findById(req.user.id).select(
      "accountType companyId role"
    );
    if (!dbUser)
      return res.status(401).json({ message: "Utilisateur introuvable" });

    if (dbUser.accountType !== "company" || !dbUser.companyId) {
      return res
        .status(400)
        .json({ message: "Action réservée au mode entreprise" });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    // ✅ défense : refuse toute note hors entreprise
    if (!expense.companyId) {
      return res.status(400).json({ message: "Note hors entreprise" });
    }

    // ✅ même company obligatoire
    if (String(expense.companyId) !== String(dbUser.companyId)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // ✅ option métier recommandée : empêcher auto-refus
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
   * body: { to: string, message?: string }
   *
   * Règles:
   * - solo: envoie toutes ses notes
   * - company: seulement manager/admin, envoie uniquement les notes approved de la company
   * - employee: interdit
   *
   * Comportement:
   * - email avec récapitulatif des notes
   * - joint les justificatifs trouvés (limités)
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

      // validation minimale email
      const toStr = typeof to === "string" ? to.trim() : "";
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(toStr)) {
        return res.status(400).json({ message: "Email destinataire invalide" });
      }

      // Construire le filtre selon règles métier
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
        // ✅ company => seulement les notes approuvées
        filter = { companyId: dbUser.companyId, status: "approved" };
      }

      // Récupérer les notes
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

      // Construire le récap
      const ownerLabel =
        dbUser.accountType === "solo"
          ? `Utilisateur: ${dbUser.name || ""}${dbUser.email ? ` (${dbUser.email})` : ""}`
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

        const dateStr = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "-";
        const empName = e.user?.name || e.user?.email || "—";

        lines.push(
          `- ${dateStr} | ${e.title} | ${amount.toFixed(2)} € | ${e.category || "-"} | ${e.status}${
            dbUser.accountType === "company" ? ` | ${empName}` : ""
          }`
        );
      }

      lines.push("", `Total: ${total.toFixed(2)} €`);

      // Pièces jointes: justificatifs (limités)
      // (évite d'exploser la taille/quotas SMTP)
      const MAX_ATTACHMENTS = 10;
      const attachments = [];

      for (const e of expenses) {
        if (attachments.length >= MAX_ATTACHMENTS) break;

        const receiptPath = e.receipt?.path;
        if (!receiptPath) continue;

        // sécurité: n'attache que si le fichier existe
        if (!fs.existsSync(receiptPath)) continue;

        attachments.push({
          filename:
            e.receipt.originalName ||
            e.receipt.filename ||
            path.basename(receiptPath),
          path: receiptPath,
          contentType: e.receipt.mimeType,
        });
      }

      // Ajouter une note si on a tronqué
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

      return res.json({
        message: "Email envoyé",
        count: expenses.length,
        attachments: attachments.length,
        total: Number(total.toFixed(2)),
      });
    } catch (err) {
      console.error("Erreur envoi email (batch) :", err);
      return res.status(500).json({ message: "Erreur lors de l'envoi de l'email" });
    }
  });


export default router;
