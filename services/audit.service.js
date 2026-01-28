// services/audit.service.js
import AuditLog from "../models/auditLog.model.js";

export async function logAudit({
  req,
  actorId,
  companyId = null,
  action,
  targetType,
  targetId,
  metadata = {},
}) {
  try {
    await AuditLog.create({
      companyId,
      actor: actorId,
      action,
      targetType,
      targetId,
      metadata,
      ip: req?.ip || "",
      userAgent: req?.headers?.["user-agent"] || "",
    });
  } catch (err) {
    // Important: l'audit ne doit jamais casser le flux métier
    console.error("Audit log error:", err);
  }
}
