import express from "express";
import upload from "../middlewares/upload.js";
import fs from "fs";
import { authenticate } from "../middlewares/auth.js";
import OpenAI from "openai";

const router = express.Router();

// IMPORTANT : ne pas initialiser OpenAI avant dotenv
// server.js doit appeler dotenv.config() avant les imports de routes

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post("/", authenticate, upload.single("receipt"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Fichier manquant" });
    }

    const imageBuffer = fs.readFileSync(req.file.path);

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract expense data from this receipt. Return only valid JSON. " +
                "JSON fields: title, amount, date, category (transport, repas, hébergement, autre), description.",
            },
            {
              type: "image",
              image: imageBuffer.toString("base64"),
            },
          ],
        },
      ],
      max_tokens: 200,
    });

    const raw = response.choices[0].message.content;
    const data = JSON.parse(raw);

    res.json(data);

  } catch (err) {
    console.error("Erreur IA:", err);
    res.status(500).json({
      message: "Erreur d'analyse IA",
      error: err.message,
    });
  }
});

export default router;
