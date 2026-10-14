// routes/admin.routes.js
// Espace super-administrateur : gestion de tous les comptes et entreprises du site.
import express from "express";
import mongoose from "mongoose";
import User from "../models/user.model.js";
import Company from "../models/company.model.js";
import Expense from "../models/expense.model.js";
import { authenticate } from "../middlewares/auth.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { deleteReceipt } from "../services/storage.service.js";
import { logAudit } from "../services/audit.service.js";

const router = express.Router();

router.use(authenticate, requireAdmin);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/admin/stats
 * Chiffres globaux du site
 */
router.get("/stats", async (req, res) => {
  try {
    const [users, activeUsers, companies, expenseAgg] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      Company.countDocuments(),
      Expense.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$amount" } } },
      ]),
    ]);

    const expenses = { pending: 0, approved: 0, rejected: 0, total: 0, amount: 0 };
    for (const row of expenseAgg) {
      expenses[row._id || "pending"] += row.count;
      expenses.total += row.count;
      expenses.amount += row.total || 0;
    }

    return res.json({ users, activeUsers, companies, expenses });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur chargement statistiques" });
  }
});

/**
 * GET /api/admin/users?search=&role=&accountType=
 * Tous les utilisateurs du site
 */
router.get("/users", async (req, res) => {
  try {
    const { search, role, accountType } = req.query;
    const filter = {};

    if (typeof search === "string" && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ name: rx }, { email: rx }];
    }
    if (["employee", "manager", "admin"].includes(role)) filter.role = role;
    if (["solo", "company"].includes(accountType)) filter.accountType = accountType;

    const users = await User.find(filter)
      .select("name email role accountType companyId isActive createdAt")
      .populate("companyId", "name")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    // nombre de notes par utilisateur
    const counts = await Expense.aggregate([
      { $match: { user: { $in: users.map((u) => u._id) } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]);
    const countById = new Map(counts.map((c) => [String(c._id), c.count]));

    return res.json(
      users.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        accountType: u.accountType,
        company: u.companyId ? { id: u.companyId._id, name: u.companyId.name } : null,
        isActive: u.isActive,
        createdAt: u.createdAt,
        expenseCount: countById.get(String(u._id)) || 0,
      }))
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur chargement utilisateurs" });
  }
});

/**
 * PATCH /api/admin/users/:id
 * body: { isActive?: boolean, role?: "employee" | "manager" }
 * Le rôle ne se change que pour les comptes entreprise.
 * La promotion en admin se fait uniquement via scripts/create-admin.js.
 */
router.patch("/users/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Identifiant invalide" });
    }
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ message: "Vous ne pouvez pas modifier votre propre compte ici" });
    }

    const { isActive, role } = req.body;
    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive doit être un boolean" });
    }
    if (role !== undefined && !["employee", "manager"].includes(role)) {
      return res.status(400).json({ message: "Rôle invalide" });
    }
    if (isActive === undefined && role === undefined) {
      return res.status(400).json({ message: "Aucune donnée à mettre à jour" });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "Utilisateur introuvable" });

    if (target.role === "admin") {
      return res.status(400).json({ message: "Un administrateur ne peut pas être modifié ici" });
    }

    const before = { isActive: target.isActive, role: target.role };

    if (role !== undefined && role !== target.role) {
      if (target.accountType !== "company" || !target.companyId) {
        return res.status(400).json({ message: "Le rôle ne se change que pour un compte entreprise" });
      }
      // une entreprise doit garder au moins un manager
      if (target.role === "manager" && role === "employee") {
        const otherManagers = await User.countDocuments({
          companyId: target.companyId,
          role: "manager",
          _id: { $ne: target._id },
        });
        if (otherManagers === 0) {
          return res.status(400).json({ message: "C'est le seul manager de l'entreprise" });
        }
      }
      target.role = role;
    }

    if (isActive !== undefined) target.isActive = isActive;

    await target.save();

    await logAudit({
      req,
      actorId: req.user.id,
      companyId: target.companyId || null,
      action: "admin.user.updated",
      targetType: "user",
      targetId: target._id,
      metadata: { before, after: { isActive: target.isActive, role: target.role } },
    });

    return res.json({ ok: true, _id: target._id, isActive: target.isActive, role: target.role });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur mise à jour utilisateur" });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Supprime le compte, ses notes et leurs justificatifs
 */
router.delete("/users/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Identifiant invalide" });
    }
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ message: "Vous ne pouvez pas supprimer votre propre compte" });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "Utilisateur introuvable" });

    if (target.role === "admin") {
      return res.status(400).json({ message: "Un administrateur ne peut pas être supprimé ici" });
    }

    // ne pas laisser une entreprise avec des membres mais sans manager
    if (target.companyId && target.role === "manager") {
      const [otherManagers, otherMembers] = await Promise.all([
        User.countDocuments({ companyId: target.companyId, role: "manager", _id: { $ne: target._id } }),
        User.countDocuments({ companyId: target.companyId, _id: { $ne: target._id } }),
      ]);
      if (otherManagers === 0 && otherMembers > 0) {
        return res.status(400).json({
          message: "C'est le seul manager de l'entreprise : nommez d'abord un autre manager",
        });
      }
    }

    const expenses = await Expense.find({ user: target._id }).select("receipt");
    await Expense.deleteMany({ user: target._id });
    await Promise.all(expenses.map((e) => deleteReceipt(e.receipt)));

    // dernier membre d'une entreprise → l'entreprise disparaît avec lui
    let companyDeleted = false;
    if (target.companyId) {
      const remaining = await User.countDocuments({ companyId: target.companyId, _id: { $ne: target._id } });
      if (remaining === 0) {
        await Company.deleteOne({ _id: target.companyId });
        companyDeleted = true;
      }
    }

    await target.deleteOne();

    await logAudit({
      req,
      actorId: req.user.id,
      companyId: target.companyId || null,
      action: "admin.user.deleted",
      targetType: "user",
      targetId: target._id,
      metadata: { email: target.email, expensesDeleted: expenses.length, companyDeleted },
    });

    return res.json({ ok: true, expensesDeleted: expenses.length, companyDeleted });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur suppression utilisateur" });
  }
});

/**
 * GET /api/admin/companies
 * Toutes les entreprises avec leur nombre de membres et de notes
 */
router.get("/companies", async (req, res) => {
  try {
    const companies = await Company.find()
      .select("name inviteCode createdBy createdAt")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .lean();

    const ids = companies.map((c) => c._id);
    const [members, expenses] = await Promise.all([
      User.aggregate([
        { $match: { companyId: { $in: ids } } },
        { $group: { _id: "$companyId", count: { $sum: 1 } } },
      ]),
      Expense.aggregate([
        { $match: { companyId: { $in: ids } } },
        { $group: { _id: "$companyId", count: { $sum: 1 }, total: { $sum: "$amount" } } },
      ]),
    ]);
    const membersById = new Map(members.map((m) => [String(m._id), m.count]));
    const expensesById = new Map(expenses.map((e) => [String(e._id), e]));

    return res.json(
      companies.map((c) => ({
        _id: c._id,
        name: c.name,
        inviteCode: c.inviteCode,
        createdAt: c.createdAt,
        createdBy: c.createdBy ? { name: c.createdBy.name, email: c.createdBy.email } : null,
        memberCount: membersById.get(String(c._id)) || 0,
        expenseCount: expensesById.get(String(c._id))?.count || 0,
        expenseTotal: expensesById.get(String(c._id))?.total || 0,
      }))
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erreur chargement entreprises" });
  }
});

export default router;
