import express from "express";
import upload from "../middlewares/upload.js";
import fs from "fs";
import { authenticate } from "../middlewares/auth.js";
import vision from "@google-cloud/vision";

const router = express.Router();

// Client Google Vision
const client = new vision.ImageAnnotatorClient();

// Utilitaire : parsing texte OCR → JSON note de frais
function parseExpenseFromText(text) {
  const amountMatch = text.match(/(\d+[.,]\d{2})\s?(€|eur)/i);
  const dateMatch = text.match(
    /(\d{2}[\/.-]\d{2}[\/.-]\d{2,4})/
  );

  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(",", "."))
    : null;

  const date = dateMatch
    ? new Date(dateMatch[1].replace(/-/g, "/"))
        .toISOString()
        .slice(0, 10)
    : null;

  let category = "autre";
  if (/restaurant|repas|déjeuner|diner/i.test(text)) category = "repas";
  if (/hotel|hébergement/i.test(text)) category = "hébergement";
  if (/taxi|uber|sncf|train|transport/i.test(text)) category = "transport";

  const title =
    category === "repas"
      ? "Repas"
      : category === "transport"
      ? "Frais de transport"
      : "Note de frais";

  return {
    title,
    amount,
    date,
    category,
    description: "Analyse automatique via Google Vision OCR",
  };
}

router.post(
  "/",
  authenticate,
  upload.single("receipt"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Fichier manquant" });
      }

      const [result] = await client.textDetection(req.file.path);
      const text = result.fullTextAnnotation?.text;

      if (!text) {
        return res
          .status(400)
          .json({ message: "Impossible de lire le justificatif" });
      }

      const data = parseExpenseFromText(text);

      res.json(data);
    } catch (err) {
      console.error("Erreur Google Vision:", err);
      res.status(500).json({
        message: "Erreur analyse justificatif",
        error: err.message,
      });
    } finally {
      // nettoyage fichier uploadé
      fs.unlink(req.file.path, () => {});
    }
  }
);

export default router;
