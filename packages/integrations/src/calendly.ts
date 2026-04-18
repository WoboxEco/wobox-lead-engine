import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CalendlyInviteeCreatedEvent {
  event: 'invitee.created';
  payload: {
    email: string;
    name?: string;
    event: { uri: string; start_time: string; end_time: string };
  };
}

export function verifyCalendlySignature(params: {
  rawBody: string;
  signatureHeader: string;
  signingKey: string;
}): boolean {
  // Format: "t=<timestamp>,v1=<hmac>"
  const parts = Object.fromEntries(
    params.signatureHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k ?? '', v ?? ''];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expected = createHmac('sha256', params.signingKey).update(`${timestamp}.${params.rawBody}`).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseInviteeEvent(rawBody: string): CalendlyInviteeCreatedEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as CalendlyInviteeCreatedEvent;
    if (parsed.event !== 'invitee.created') return null;
    return parsed;
  } catch {
    return null;
  }
}
