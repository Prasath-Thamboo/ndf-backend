import express from "express";
import Expense from "../models/expense.model.js";
import { authenticate } from "../middlewares/auth.js";
import upload from "../middlewares/upload.js";

import vision from "@google-cloud/vision";
import parseExpenseFromText from "../services/parseExpenseFromText.js";

const router = express.Router();
const visionClient = new vision.ImageAnnotatorClient();

/**
 * ===========================
 * SCAN IA — PRÉVISUALISATION (SANS SAUVEGARDE)
 * POST /api/expenses/scan-preview
 * ===========================
 */
router.post(
  "/scan-preview",
  authenticate,
  upload.single("receipt"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Justificatif requis" });
      }

      const [result] = await visionClient.textDetection(req.file.path);
      const text = result.fullTextAnnotation?.text;

      if (!text) {
        return res.status(400).json({ message: "Impossible de lire le justificatif" });
      }

      const parsedData = parseExpenseFromText(text);
      return res.json(parsedData);
    } catch (err) {
      console.error("Erreur analyse IA :", err);
      return res.status(500).json({ message: "Erreur lors de l'analyse IA" });
    }
  }
);

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

    const receipt = req.file
      ? {
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          path_toggle: undefined,
          path: req.file.path,
          size: req.file.size,
        }
      : null;

    const expense = await Expense.create({
      user: req.user.id,
      title,
      amount: Number(amount),
      date: new Date(date),
      category,
      description,
      receipt,
      createdByAI: false,
      // status: "pending" // si ton modèle a un default, pas nécessaire
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
 * LISTE DES NOTES (UTILISATEUR)
 * GET /api/expenses
 * ===========================
 */
router.get("/", authenticate, async (req, res) => {
  try {
    const expenses = await Expense.find({ user: req.user.id }).sort({ createdAt: -1 });
    return res.json(expenses);
  } catch (err) {
    console.error("Erreur chargement notes :", err);
    return res.status(500).json({ message: "Erreur lors du chargement des notes de frais" });
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
    const expense = await Expense.findOne({ _id: req.params.id, user: req.user.id });
    if (!expense) return res.status(404).json({ message: "Note introuvable" });
    return res.json(expense);
  } catch (err) {
    console.error("Erreur lecture note :", err);
    return res.status(500).json({ message: "Erreur lors de la lecture de la note de frais" });
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
    const expense = await Expense.findOne({ _id: req.params.id, user: req.user.id });
    if (!expense) return res.status(404).json({ message: "Note introuvable" });

    const status = expense.status ?? "pending";
    if (expense.status !== "pending") {
  return res.status(400).json({ message: "Suppression impossible : note non 'pending'" });
}

    await expense.deleteOne();
    return res.json({ message: "Note supprimée" });
  } catch (err) {
    console.error("Erreur suppression note :", err);
    return res.status(500).json({ message: "Erreur lors de la suppression de la note de frais" });
  }
});

export default router;
