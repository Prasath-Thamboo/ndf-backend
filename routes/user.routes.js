// backend/routes/user.routes.js
import express from "express";
import {
  registerUser,
  loginUser,
  getMe,
  updateMe,
} from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", authenticate, getMe);

// ✅ AJOUT : mise à jour profil (nom / email)
router.patch("/me", authenticate, updateMe);

export default router;
