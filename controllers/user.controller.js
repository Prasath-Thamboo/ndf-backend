import User from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function registerUser(req, res) {
  try {
    const { name, email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "Email déjà utilisé" });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      passwordHash,
      role: "user",
      isActive: true,
    });

    res.status(201).json({ message: "Compte créé", user: user._id });

  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

export async function loginUser(req, res) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Identifiants invalides" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).json({ message: "Identifiants invalides" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

export async function getMe(req, res) {
  try {
    const user = await User.findById(req.user.id).select("-passwordHash");
    res.json(user);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}
