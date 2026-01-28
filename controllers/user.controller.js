// controllers/user.controller.js
import User from "../models/user.model.js";
import Company from "../models/company.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

function generateInviteCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I/O/1/0
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function createUniqueInviteCode() {
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode(6);
    const exists = await Company.findOne({ inviteCode: code });
    if (!exists) return code;
  }
  throw new Error("Impossible de générer un code d'invitation unique");
}

function signToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      accountType: user.accountType,
      companyId: user.companyId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export async function registerUser(req, res) {
  try {
    const { name, email, password, accountType, companyName, inviteCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Nom, email et mot de passe requis" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(400).json({ message: "Email déjà utilisé" });

    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ SOLO
    if (!accountType || accountType === "solo") {
      const user = await User.create({
        name,
        email: normalizedEmail,
        passwordHash,
        accountType: "solo",
        companyId: null,
        role: "manager",
        isActive: true,
      });

      const token = signToken(user);

      return res.status(201).json({
        message: "Compte créé",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          accountType: user.accountType,
          companyId: user.companyId,
        },
      });
    }

    // ✅ COMPANY
    if (accountType !== "company") {
      return res.status(400).json({ message: "accountType invalide" });
    }

    // Cas A: création entreprise (manager)
    if (companyName && String(companyName).trim()) {
      const code = await createUniqueInviteCode();

      const user = await User.create({
        name,
        email: normalizedEmail,
        passwordHash,
        accountType: "company",
        companyId: null,
        role: "manager",
        isActive: true,
      });

      const company = await Company.create({
        name: String(companyName).trim(),
        createdBy: user._id,
        inviteCode: code,
        settings: { autoApproveSolo: true },
      });

      user.companyId = company._id;
      await user.save();

      const token = signToken(user);

      return res.status(201).json({
        message: "Compte entreprise créé",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          accountType: user.accountType,
          companyId: user.companyId,
        },
        company: { id: company._id, name: company.name, inviteCode: company.inviteCode },
      });
    }

    // Cas B: rejoindre entreprise (employee)
    if (!inviteCode || !String(inviteCode).trim()) {
      return res.status(400).json({
        message: "inviteCode requis pour rejoindre une entreprise (ou companyName pour créer).",
      });
    }

    const company = await Company.findOne({
      inviteCode: String(inviteCode).trim().toUpperCase(),
    });

    if (!company) {
      return res.status(400).json({ message: "Code d'invitation invalide" });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      accountType: "company",
      companyId: company._id,
      role: "employee",
      isActive: true,
    });

    const token = signToken(user);

    return res.status(201).json({
      message: "Compte employé créé",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountType: user.accountType,
        companyId: user.companyId,
      },
      company: { id: company._id, name: company.name },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
}

export async function loginUser(req, res) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return res.status(400).json({ message: "Identifiants invalides" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).json({ message: "Identifiants invalides" });

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountType: user.accountType,
        companyId: user.companyId,
      },
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

export const updateMe = async (req, res) => {
  try {
    const { name, email } = req.body;

    const hasName = typeof name === "string" && name.trim().length > 0;
    const hasEmail = typeof email === "string" && email.trim().length > 0;

    if (!hasName && !hasEmail) {
      return res.status(400).json({ message: "Aucune donnée à mettre à jour" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

    if (hasName) user.name = name.trim();
    if (hasEmail) user.email = email.trim().toLowerCase();

    await user.save();

    // ✅ on renvoie exactement la forme attendue par le front (comme /me)
    return res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      accountType: user.accountType,
      companyId: user.companyId || null,
    });
  } catch (err) {
    console.error("updateMe error:", err);

    // email unique déjà pris
    if (err?.code === 11000) {
      return res.status(400).json({ message: "Cet email est déjà utilisé" });
    }

    return res.status(500).json({ message: "Erreur lors de la mise à jour du profil" });
  }
};

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Mot de passe actuel et nouveau mot de passe requis",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Le nouveau mot de passe doit contenir au moins 8 caractères",
      });
    }

    const user = await User.findById(req.user.id).select("passwordHash");
    if (!user) {
      return res.status(401).json({ message: "Utilisateur introuvable" });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(403).json({
        message: "Mot de passe actuel incorrect",
      });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    user.passwordHash = hash;
    await user.save();

    // 🧾 audit
    await logAudit({
      req,
      actorId: req.user.id,
      companyId: req.user.companyId || null,
      action: "user.password.changed",
      targetType: "user",
      targetId: req.user.id,
      metadata: {},
    });

    return res.json({
      message: "Mot de passe modifié. Veuillez vous reconnecter.",
      forceLogout: true,
    });
  } catch (err) {
    console.error("Erreur change password :", err);
    return res.status(500).json({
      message: "Erreur lors du changement de mot de passe",
    });
  }
}