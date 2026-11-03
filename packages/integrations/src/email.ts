import { env } from '@wobox/core';
import nodemailer, { type Transporter } from 'nodemailer';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

let transporter: Transporter | null = null;

/** true si GMAIL_USER + GMAIL_APP_PASSWORD estan seteadas. */
export function isConfigured(): boolean {
  const e = env();
  return Boolean(e.GMAIL_USER && e.GMAIL_APP_PASSWORD);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const e = env();
  if (!e.GMAIL_USER || !e.GMAIL_APP_PASSWORD) {
    throw new Error('Email no configurado: faltan GMAIL_USER / GMAIL_APP_PASSWORD');
  }
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: e.GMAIL_USER, pass: e.GMAIL_APP_PASSWORD },
  });
  return transporter;
}

/** Envia un email de texto plano via Google Workspace SMTP. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const e = env();
  const info = await getTransporter().sendMail({
    from: `"${e.EMAIL_FROM_NAME}" <${e.GMAIL_USER}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
  return {
    messageId: info.messageId,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  };
}
