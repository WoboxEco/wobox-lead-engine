export const ALLOWED_EMAILS = new Set<string>([
  'sebastian@wobox.ar',
  'juan@wobox.ar',
  'vir@wobox.ar',
]);

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.has(email.toLowerCase().trim());
}
