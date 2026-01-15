import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },

    category: {
      type: String,
      enum: ["transport", "repas", "hébergement", "autre"],
      default: "autre",
    },

    description: String,

    // 🧾 Justificatif
    receipt: {
      filename: String,
      originalName: String,
      mimeType: String,
      path: String,
      size: Number,
    },

    // 🧠 IA
    createdByAI: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Expense", expenseSchema);
