import multer from "multer";

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo

// Le fichier reste en mémoire (req.file.buffer) : c'est storage.service.js
// qui l'enregistre, et seulement une fois la requête validée.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
    "application/pdf",
  ];
  if (allowed.includes(file.mimetype)) return cb(null, true);

  const err = new Error("Format non supporté. Formats acceptés : JPG, PNG, WEBP, PDF");
  err.status = 400;
  cb(err, false);
};

export default multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });
