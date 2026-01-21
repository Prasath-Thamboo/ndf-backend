// models/expense.model.js
import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ✅ Nouveau: rattachement société (null si solo)
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
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

    receipt: {
      filename: String,
      originalName: String,
      mimeType: String,
      path: String,
      size: Number,
    },

    createdByAI: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    // ✅ Nouveau: validation/refus
    validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    validatedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Expense", expenseSchema);
