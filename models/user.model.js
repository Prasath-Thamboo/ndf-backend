import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    /**
     * Rôle fonctionnel
     * - manager : valide/refuse les notes
     * - employee : soumet des notes
     * - admin : super-admin (optionnel plus tard)
     */
    role: {
      type: String,
      enum: ["manager", "employee", "admin"],
      default: "manager",
    },

    /**
     * Type de compte
     * - solo : auto-validation des notes
     * - company : workflow manager/employé
     */
    accountType: {
      type: String,
      enum: ["solo", "company"],
      required: true,
    },

    /**
     * Société associée (null si solo)
     */
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", userSchema);
