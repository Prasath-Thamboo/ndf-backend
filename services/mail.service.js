// services/mail.service.js
import nodemailer from "nodemailer";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getMailer() {
  const host = requireEnv("SMTP_HOST");
  const port = Number(requireEnv("SMTP_PORT"));
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // standard
    auth: { user, pass },
  });
}

export async function sendExpenseEmail({
  to,
  subject,
  text,
  html,
  attachments = [],
}) {
  const transporter = getMailer();

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });

  return info;
}
