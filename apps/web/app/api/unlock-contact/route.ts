import { createAdminClient } from '@wobox/core';
import { revealEmail } from '@wobox/skills';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { contactId } = (await req.json()) as { contactId: string };
    if (!contactId) return NextResponse.json({ error: 'missing contactId' }, { status: 400 });

    const db = createAdminClient();
    const r = await revealEmail.revealContact(db, contactId, 'unlock-contact');

    switch (r.status) {
      case 'contact_not_found':
        return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 });
      case 'person_not_found':
        return NextResponse.json({ error: 'Apollo no encontró el contacto' }, { status: 404 });
      case 'no_email':
        return NextResponse.json(
          { error: 'Apollo encontró el contacto pero no tiene email público disponible' },
          { status: 404 },
        );
      case 'revealed':
        return NextResponse.json({ email: r.email, name: r.name, linkedin_url: r.linkedin_url });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
