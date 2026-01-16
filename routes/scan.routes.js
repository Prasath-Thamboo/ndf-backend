import express from "express";
import upload from "../middlewares/upload.js";
import fs from "fs/promises";
import OpenAI from "openai";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Types MIME autorisés (double sécurité : multer + route)
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * =====================================================
 * SCAN IA — PRÉVISUALISATION (SANS CRÉATION EN BASE)
 * POST /api/scan
 * =====================================================
 */
router.post("/", authenticate, upload.single("receipt"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Fichier manquant" });
    }

    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(400).json({
        message: "Format non supporté. Formats acceptés : JPG, PNG, WEBP",
      });
    }

    // Lecture du fichier et conversion en data URL
    const buffer = await fs.readFile(req.file.path);
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Appel OpenAI Vision
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `
Tu es un extracteur de notes de frais.
Tu DOIS répondre UNIQUEMENT avec un JSON valide (pas de texte, pas de markdown).

Champs attendus :
{
  title: string,
  amount: number | null,
  date: string (YYYY-MM-DD) | null,
  category: "transport" | "repas" | "hébergement" | "autre",
  description: string | null
}

Si une information est introuvable :
- mets null (sauf category -> "autre")
`.trim(),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyse ce justificatif et extrais les informations demandées.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    // Parsing robuste du JSON
    const json = extractJson(raw);

    // Normalisation / sécurisation
    const normalized = {
      title:
        typeof json.title === "string" && json.title.trim()
          ? json.title.trim()
          : "Note de frais",

      amount:
        typeof json.amount === "number"
          ? json.amount
          : typeof json.amount === "string"
          ? parseAmount(json.amount)
          : null,

      date: normalizeDate(json.date),
      category: normalizeCategory(json.category),
      description:
        typeof json.description === "string" ? json.description.trim() : "",
    };

    return res.json(normalized);
  } catch (err) {
    const status = err?.status || err?.response?.status;

    if (status === 429) {
      return res.status(429).json({
        message: "Quota OpenAI dépassé. Réessaie plus tard.",
        code: "SCAN_QUOTA",
      });
    }

    console.error("Erreur scan IA :", err);
    return res.status(500).json({
      message: "Erreur lors de l'analyse IA",
      code: "SCAN_FAILED",
    });
  }
});

export default router;

/* =====================================================
 * Helpers
 * ===================================================== */

function extractJson(text) {
  // Support JSON brut ou ```json ... ```
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Réponse IA non parsable en JSON");
  }

  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice);
}

function parseAmount(value) {
  const cleaned = String(value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeCategory(cat) {
  const v = String(cat || "").toLowerCase();

  if (v.includes("trans")) return "transport";
  if (v.includes("rep")) return "repas";
  if (v.includes("héberg") || v.includes("heberg") || v.includes("hotel"))
    return "hébergement";

  return "autre";
}

function normalizeDate(value) {
  if (!value) return null;

  const s = String(value).trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}
