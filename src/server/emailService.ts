import nodemailer from 'nodemailer';

export class EmailDeliveryError extends Error {}

function smtpPort(): number {
  const value = Number(process.env.SMTP_PORT || 587);
  return Number.isInteger(value) && value > 0 ? value : 587;
}

export function emailRecoveryConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM);
}

export async function sendRecoveryCode(email: string, code: string): Promise<void> {
  if (!emailRecoveryConfigured()) {
    throw new EmailDeliveryError('Email recovery is not configured.');
  }
  const port = smtpPort();
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Your Matatu SACCO password recovery code',
    text: `Your password recovery code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    html: `<p>Your password recovery code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request it, ignore this email.</p>`
  });
}
