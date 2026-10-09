// routes/user.routes.js
import express from "express";
import {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  changePassword,
} from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", authenticate, getMe);
router.patch("/me", authenticate, updateMe);

// 🔐 changement mot de passe
router.post("/change-password", authenticate, changePassword);

export default router;
