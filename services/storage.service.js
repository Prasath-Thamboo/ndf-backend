// services/storage.service.js
// Stockage des justificatifs :
// - "local" (par défaut) : dossier uploads/ du serveur, pratique en développement
// - "s3" : stockage objet compatible S3 (Cloudflare R2, AWS S3...), requis en production
//   sur les hébergeurs dont le disque est effacé à chaque redéploiement.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export const STORAGE_DRIVER = process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";

const LOCAL_DIR_NAME = "uploads";
const LOCAL_DIR = path.resolve(LOCAL_DIR_NAME);

let s3Client = null;
function getS3() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

// nom généré : évite les caractères exotiques et les collisions
function generateFilename(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
}

// Les anciennes notes n'ont pas de champ "storage" : elles sont en local
function driverOf(receipt) {
  return receipt?.storage === "s3" ? "s3" : "local";
}

// Chemin local sécurisé : le fichier doit rester dans uploads/
function safeLocalPath(receipt) {
  if (!receipt?.path) return null;
  const resolved = path.resolve(receipt.path);
  return resolved.startsWith(LOCAL_DIR + path.sep) ? resolved : null;
}

/**
 * Enregistre un fichier reçu par multer (memoryStorage) et renvoie
 * l'objet "receipt" à stocker sur la note.
 * receipt.path = chemin local, ou clé de l'objet en mode s3.
 */
export async function saveReceipt(file) {
  const filename = generateFilename(file.originalname);
  const base = {
    filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };

  if (STORAGE_DRIVER === "s3") {
    const key = `receipts/${filename}`;
    await getS3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );
    return { ...base, storage: "s3", path: key };
  }

  await fs.promises.mkdir(LOCAL_DIR, { recursive: true });
  // séparateur "/" : le chemin reste valide si la base est relue sous Linux
  const relativePath = `${LOCAL_DIR_NAME}/${filename}`;
  await fs.promises.writeFile(path.resolve(relativePath), file.buffer);
  return { ...base, storage: "local", path: relativePath };
}

/** Contenu du justificatif (Buffer), ou null s'il est introuvable. */
export async function readReceipt(receipt) {
  if (!receipt?.path) return null;

  if (driverOf(receipt) === "s3") {
    try {
      const res = await getS3().send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: receipt.path })
      );
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (err?.name === "NoSuchKey") return null;
      throw err;
    }
  }

  const localPath = safeLocalPath(receipt);
  if (!localPath) return null;
  try {
    return await fs.promises.readFile(localPath);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Supprime le justificatif (sans jamais lever d'erreur). */
export async function deleteReceipt(receipt) {
  if (!receipt?.path) return;

  try {
    if (driverOf(receipt) === "s3") {
      await getS3().send(
        new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: receipt.path })
      );
      return;
    }

    const localPath = safeLocalPath(receipt);
    if (localPath) await fs.promises.unlink(localPath);
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Suppression justificatif impossible :", err);
  }
}
