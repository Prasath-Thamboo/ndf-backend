// server.js
// 🔥 CHARGER DOTENV AVANT TOUT
import "./load-env.js";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import multer from "multer";

import { checkEnv } from "./config/checkEnv.js";
import { STORAGE_DRIVER } from "./services/storage.service.js";
import userRoutes from "./routes/user.routes.js";
import expenseRoutes from "./routes/expense.routes.js";
import scanRoutes from "./routes/scan.routes.js";
import companyRoutes from "./routes/company.routes.js";
import auditRoutes from "./routes/audit.routes.js";

checkEnv();

const app = express();

// Derrière le proxy de l'hébergeur (Render, Railway...) : nécessaire pour
// que le rate-limit voie la vraie IP du client
app.set("trust proxy", 1);

app.use(helmet());

// CORS_ORIGIN peut contenir plusieurs URLs séparées par des virgules
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json({ limit: "100kb" }));

// Limites de requêtes (par IP)
const limitOptions = { standardHeaders: "draft-8", legacyHeaders: false };

const apiLimiter = rateLimit({
  ...limitOptions,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message: { message: "Trop de requêtes. Réessayez dans quelques minutes." },
});

// connexion / inscription : contre les attaques par force brute
const authLimiter = rateLimit({
  ...limitOptions,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { message: "Trop de tentatives. Réessayez dans 15 minutes." },
});

// scan IA : chaque appel est facturé
const scanLimiter = rateLimit({
  ...limitOptions,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: { message: "Limite de scans atteinte. Réessayez plus tard.", code: "SCAN_QUOTA" },
});

app.use("/api", apiLimiter);
app.use(["/api/auth/login", "/api/auth/register"], authLimiter);

// Routes
app.use("/api/auth", userRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/scan", scanLimiter, scanRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/audit", auditRoutes);


// (optionnel) route santé
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Erreurs non gérées par les routes → toujours du JSON
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Fichier trop volumineux (5 Mo maximum)"
        : "Erreur lors de l'envoi du fichier";
    return res.status(400).json({ message });
  }

  if (err.status === 400) {
    return res.status(400).json({ message: err.message });
  }

  console.error("Erreur serveur :", err);
  return res.status(500).json({ message: "Erreur serveur" });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(process.env.PORT || 4000, () =>
      console.log(
        `Backend running on port ${process.env.PORT || 4000} (stockage : ${STORAGE_DRIVER})`
      )
    );
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
