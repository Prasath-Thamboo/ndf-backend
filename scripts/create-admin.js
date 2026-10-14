// scripts/create-admin.js
// Crée le compte super-administrateur, ou promeut un compte existant.
//
//   npm run create-admin -- admin@exemple.fr "Nom affiché"
//
// Le mot de passe est demandé au clavier (ou lu dans ADMIN_PASSWORD) ;
// il n'est demandé que si le compte n'existe pas encore.
// Pour la production : lancer en local avec MONGO_URI pointant vers Atlas.
import "../load-env.js";

import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/user.model.js";

const [, , rawEmail, rawName] = process.argv;

if (!rawEmail || !rawEmail.includes("@")) {
  console.error('Usage : npm run create-admin -- <email> ["Nom"]');
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error("MONGO_URI est manquant (fichier .env).");
  process.exit(1);
}

const email = rawEmail.toLowerCase().trim();

async function askPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const password = await rl.question("Mot de passe du compte admin (8 caractères min.) : ");
  rl.close();
  return password;
}

try {
  await mongoose.connect(process.env.MONGO_URI);

  const existing = await User.findOne({ email });

  if (existing) {
    if (existing.role === "admin") {
      console.log(`${email} est déjà administrateur.`);
    } else {
      existing.role = "admin";
      existing.isActive = true;
      await existing.save();
      console.log(`✅ ${email} est maintenant administrateur.`);
    }
  } else {
    const password = await askPassword();
    if (!password || password.length < 8) {
      throw new Error("Mot de passe trop court (8 caractères minimum).");
    }

    await User.create({
      name: rawName?.trim() || "Administrateur",
      email,
      passwordHash: await bcrypt.hash(password, 10),
      accountType: "solo",
      companyId: null,
      role: "admin",
      isActive: true,
    });
    console.log(`✅ Compte administrateur créé : ${email}`);
  }
} catch (err) {
  console.error("Erreur :", err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
