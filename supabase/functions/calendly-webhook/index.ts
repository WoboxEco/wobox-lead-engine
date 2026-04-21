// Supabase Edge Function (Deno runtime).
// Verifica signature de Calendly, matchea contacto por email y actualiza stage a meeting_booked.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CALENDLY_SIGNING_KEY = Deno.env.get('CALENDLY_SIGNING_KEY')!;

interface InviteeCreated {
  event: string;
  payload: {
    email: string;
    name?: string;
    event: { uri: string; start_time: string; end_time: string };
  };
}

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k ?? '', v ?? ''];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(CALENDLY_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === signature;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  const signature = req.headers.get('calendly-webhook-signature');

  if (!(await verifySignature(rawBody, signature))) {
    return new Response('invalid signature', { status: 401 });
  }

  let event: InviteeCreated;
  try {
    event = JSON.parse(rawBody) as InviteeCreated;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  if (event.event !== 'invitee.created') {
    return new Response('ignored', { status: 200 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = event.payload.email.toLowerCase();

  const { data: contact } = await db
    .from('contacts')
    .select('id, company_id, name')
    .eq('email', email)
    .maybeSingle();

  if (!contact) {
    // No hay match: loguear y dejar para revision manual.
    await db.from('error_logs').insert({
      skill: 'calendly-webhook',
      error_type: 'no_contact_match',
      error_message: `No contact found for ${email}`,
      context: { email, event_uri: event.payload.event.uri },
    });
    return new Response('no match', { status: 200 });
  }

  await db
    .from('companies')
    .update({ stage: 'meeting_booked', updated_at: new Date().toISOString() })
    .eq('id', contact.company_id);

  await db.from('interactions').insert({
    contact_id: contact.id,
    company_id: contact.company_id,
    type: 'meeting',
    channel: 'calendly',
    content: `Calendly booking: ${event.payload.event.start_time}`,
    outcome: 'meeting_booked',
    ai_generated: false,
  });

  return new Response('ok', { status: 200 });
});
