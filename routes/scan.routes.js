import express from "express";
import upload from "../middlewares/upload.js";
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// fichiers acceptés (côté route en plus de multer)
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

router.post("/", authenticate, upload.single("receipt"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Fichier manquant" });
    }

    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(400).json({
        message: "Format non supporté. Formats acceptés: JPG, PNG, WEBP",
      });
    }

    // Lire l'image et construire une data URL
    const imageBuffer = await fs.readFile(req.file.path);
    const base64 = imageBuffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Appel vision ChatGPT
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 350,
      messages: [
        {
          role: "system",
          content:
            "Tu extrais des informations de justificatifs (notes de frais). Réponds uniquement en JSON valide.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Analyse ce justificatif et retourne UNIQUEMENT un JSON valide avec les champs: " +
                "{ title: string, amount: number, date: string(YYYY-MM-DD), category: 'transport'|'repas'|'hébergement'|'autre', description: string }. " +
                "Si une valeur est introuvable, mets null (sauf category -> 'autre').",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const raw = response.choices?.[0]?.message?.content || "";

    // Parse robuste: on extrait le premier bloc JSON
    const json = extractJson(raw);

    // Normalisation minimale
    const data = {
      title: json.title ?? "Note de frais",
      amount:
        typeof json.amount === "number"
          ? json.amount
          : json.amount
          ? Number(String(json.amount).replace(",", "."))
          : null,
      date: normalizeDate(json.date),
      category: normalizeCategory(json.category),
      description: json.description ?? "",
    };

    return res.json(data);
  } catch (err) {
    // Gestion propre des quotas (429) et erreurs OpenAI
    const status = err?.status || err?.response?.status;

    if (status === 429) {
      return res.status(429).json({
        message:
          "Quota OpenAI dépassé. Vérifie ton plan et la facturation OpenAI.",
      });
    }

    console.error("Erreur scan IA:", err);
    return res.status(500).json({
      message: "Erreur d'analyse IA",
      error: err?.message || "unknown_error",
    });
  }
});

export default router;

// ----------------- helpers -----------------

function extractJson(text) {
  // accepte JSON pur ou JSON dans un bloc ```json
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;

  // prend du premier { au dernier }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Réponse IA non parsable en JSON");
  }

  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice);
}

function normalizeCategory(cat) {
  const v = String(cat || "").toLowerCase();
  if (v.includes("trans")) return "transport";
  if (v.includes("rep")) return "repas";
  if (v.includes("héberg") || v.includes("heberg") || v.includes("hotel"))
    return "hébergement";
  return "autre";
}

function normalizeDate(d) {
  if (!d) return null;
  // attend YYYY-MM-DD, sinon tente dd/mm/yyyy
  const s = String(d).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}
