import express from "express";
import Expense from "../models/expense.model.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

// Créer une note de frais
router.post("/", authenticate, async (req, res) => {
  try {
    const { title, amount, date, category, description } = req.body;

    if (!title || !amount || !date) {
      return res.status(400).json({ message: "Champs obligatoires manquants." });
    }

    const expense = await Expense.create({
      user: req.user.id,
      title,
      amount,
      date,
      category,
      description,
    });

    res.status(201).json(expense);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Récupérer toutes les notes de l'utilisateur connecté
router.get("/", authenticate, async (req, res) => {
  try {
    const expenses = await Expense.find({ user: req.user.id }).sort({ date: -1 });
    res.json(expenses);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Récupérer une note spécifique (si propriétaire)
router.get("/:id", authenticate, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!expense) {
      return res.status(404).json({ message: "Note de frais introuvable." });
    }

    res.json(expense);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Mettre à jour une note (seulement si pending)
router.patch("/:id", authenticate, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!expense) {
      return res.status(404).json({ message: "Note de frais introuvable." });
    }

    if (expense.status !== "pending") {
      return res
        .status(400)
        .json({ message: "Impossible de modifier une note déjà traitée." });
    }

    const { title, amount, date, category, description } = req.body;

    if (title !== undefined) expense.title = title;
    if (amount !== undefined) expense.amount = amount;
    if (date !== undefined) expense.date = date;
    if (category !== undefined) expense.category = category;
    if (description !== undefined) expense.description = description;

    await expense.save();
    res.json(expense);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Supprimer une note (seulement si pending)
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!expense) {
      return res.status(404).json({ message: "Note de frais introuvable." });
    }

    if (expense.status !== "pending") {
      return res
        .status(400)
        .json({ message: "Impossible de supprimer une note déjà traitée." });
    }

    await expense.deleteOne();
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
