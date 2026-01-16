import fs from "fs/promises";
import path from "path";
import { ScanExpenseSchema } from "../validators/scanExpense.schema.js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function toDataUrl(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

function safeExtractJson(text) {
  // prend le premier objet JSON trouvé
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const chunk = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(chunk);
  } catch {
    return null;
  }
}

function normalizeAmount(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const cleaned = v.replace(/\s/g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(v) {
  // attend YYYY-MM-DD. si le modèle renvoie autre chose, on vide.
  if (typeof v !== "string") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return "";
}

export async function scanExpenseFromFile({ filePath, mimeType }) {
  const buf = await fs.readFile(filePath);
  const base64 = buf.toString("base64");
  const imageUrl = toDataUrl(mimeType, base64);

  const system = `
Tu es un extracteur de notes de frais.
Tu dois renvoyer UNIQUEMENT un JSON valide (pas de markdown, pas de texte).
Champs attendus:
- title (string)
- amount (number)
- date (YYYY-MM-DD)
- category (transport|repas|hébergement|autre)
- description (string)
- merchant (string)
- currency (string, ex EUR)
- confidence (number 0..1)
- warnings (array de string)
Si une valeur est incertaine, laisse vide/0 et ajoute un warning.
`;

  const user = `Analyse ce justificatif et extrait les champs.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system.trim() },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  const text = resp.choices?.[0]?.message?.content ?? "";
  const json = safeExtractJson(text) ?? {};

  // Normalisation avant validation
  const normalized = {
    title: typeof json.title === "string" ? json.title.trim() : "",
    amount: normalizeAmount(json.amount),
    date: normalizeDate(json.date),
    category: ["transport", "repas", "hébergement", "autre"].includes(json.category)
      ? json.category
      : "autre",
    description: typeof json.description === "string" ? json.description.trim() : "",
    merchant: typeof json.merchant === "string" ? json.merchant.trim() : "",
    currency: typeof json.currency === "string" ? json.currency.trim() : "EUR",
  };

  const parsed = ScanExpenseSchema.safeParse(normalized);

  const confidence =
    typeof json.confidence === "number" && json.confidence >= 0 && json.confidence <= 1
      ? json.confidence
      : 0;

  const warnings = Array.isArray(json.warnings) ? json.warnings.slice(0, 10) : [];

  if (!parsed.success) {
    return {
      expense: ScanExpenseSchema.parse({}), // defaults
      confidence: 0,
      warnings: ["Réponse IA non conforme, données non fiables."],
      raw: text,
    };
  }

  return {
    expense: parsed.data,
    confidence,
    warnings,
    raw: text,
  };
}
