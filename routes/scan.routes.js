import express from "express";
import upload from "../middlewares/upload.js";
import Anthropic from "@anthropic-ai/sdk";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

// Client créé au premier scan : le serveur démarre même sans ANTHROPIC_API_KEY
let anthropic = null;
function getAnthropic() {
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

// Types MIME autorisés (double sécurité : multer + route)
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const SYSTEM_PROMPT = `
Tu es un extracteur de notes de frais à partir de justificatifs (tickets/factures).

Objectif important:
- "merchant" = nom de l'entreprise / enseigne émettrice (souvent en haut, logo/nom).
- "title" = un libellé court humain. Si possible: merchant + type (ex: "Carrefour - achat"), sinon merchant seul, sinon "Note de frais".
- "amount" = montant total TTC payé.
- "date" = date du justificatif au format YYYY-MM-DD.

Règles:
- Si introuvable: mets null (sauf category -> "autre").
- Ne devine pas: si incertain, null.
`.trim();

// Schéma imposé à la réponse de Claude (structured outputs)
const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    amount: { type: ["number", "null"] },
    date: { type: ["string", "null"] },
    category: {
      type: "string",
      enum: ["transport", "repas", "hébergement", "autre"],
    },
    description: { type: ["string", "null"] },
  },
  required: ["merchant", "title", "amount", "date", "category", "description"],
  additionalProperties: false,
};

/**
 * =====================================================
 * SCAN IA — PRÉVISUALISATION (SANS CRÉATION EN BASE)
 * POST /api/scan
 * =====================================================
 * Retour attendu (JSON):
 * {
 *   merchant: string | null,
 *   title: string,
 *   amount: number | null,
 *   date: string (YYYY-MM-DD) | null,
 *   category: "transport" | "repas" | "hébergement" | "autre",
 *   description: string | null
 * }
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

    // Prévisualisation uniquement : le fichier reste en mémoire, il sera
    // renvoyé à la création de la note
    const base64 = req.file.buffer.toString("base64");

    // Appel Claude (vision + sortie JSON structurée)
    const response = await getAnthropic().beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RECEIPT_SCHEMA },
      },
      // Si Claude refuse la requête, l'API la relance sur un modèle de repli
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: req.file.mimetype,
                data: base64,
              },
            },
            {
              type: "text",
              text: "Analyse ce justificatif. Extrais en priorité l'enseigne (merchant) et les champs demandés.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Analyse refusée par l'IA");
    }

    const raw = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parsing robuste du JSON
    const json = extractJson(raw);

    // Normalisation / sécurisation
    const merchant =
      typeof json.merchant === "string" && json.merchant.trim()
        ? json.merchant.trim()
        : null;

    const titleFromAI =
      typeof json.title === "string" && json.title.trim()
        ? json.title.trim()
        : null;

    const normalized = {
      merchant,
      // Si l'IA ne met pas title mais merchant est présent, on met merchant en title
      title: titleFromAI || merchant || "Note de frais",

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
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({
        message: "Quota IA dépassé. Réessaie plus tard.",
        code: "SCAN_QUOTA",
      });
    }

    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Clé ANTHROPIC_API_KEY absente ou invalide");
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
