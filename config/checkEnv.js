// config/checkEnv.js
// Vérifie la configuration au démarrage : mieux vaut refuser de démarrer
// que tourner en production avec un secret faible ou un stockage qui s'efface.

const PLACEHOLDERS = ["change_me_long_random_string", "secret", "changeme"];

export function checkEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  if (!process.env.MONGO_URI) errors.push("MONGO_URI est manquant.");

  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) {
    errors.push("JWT_SECRET est manquant.");
  } else if (isProd && (jwt.length < 32 || PLACEHOLDERS.includes(jwt))) {
    errors.push("JWT_SECRET est trop faible (32 caractères aléatoires minimum en production).");
  }

  if (process.env.STORAGE_DRIVER === "s3") {
    for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      if (!process.env[key]) errors.push(`${key} est requis quand STORAGE_DRIVER=s3.`);
    }
  } else if (isProd) {
    warnings.push(
      "STORAGE_DRIVER n'est pas \"s3\" : les justificatifs sont stockés sur le disque du serveur et peuvent être perdus au redéploiement."
    );
  }

  if (isProd && !process.env.CORS_ORIGIN) {
    errors.push("CORS_ORIGIN est requis en production (URL du frontend).");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey || apiKey.endsWith("...")) {
    warnings.push("ANTHROPIC_API_KEY n'est pas configurée : le scan IA sera indisponible.");
  }

  if (!process.env.SMTP_HOST) {
    warnings.push("SMTP_HOST n'est pas configuré : l'envoi des notes par email sera indisponible.");
  }

  for (const w of warnings) console.warn(`⚠️  ${w}`);

  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
}
