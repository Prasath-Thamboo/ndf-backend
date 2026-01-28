// models/auditLog.model.js
import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },

    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    action: {
      type: String,
      required: true,
      // exemples: expense.created, expense.approved, expense.rejected, expense.deleted, expenses.emailed
    },

    targetType: { type: String, required: true, enum: ["expense"] },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

AuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
AuditLogSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model("AuditLog", AuditLogSchema);
