import express from "express";
import { registerUser, loginUser, getMe } from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

// REGISTER
router.post("/register", registerUser);

// LOGIN
router.post("/login", loginUser);

// RETURN LOGGED USER
router.get("/me", authenticate, getMe);

export default router;
