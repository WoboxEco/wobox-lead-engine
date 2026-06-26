import { createAdminClient } from '@wobox/core';
import { apollo } from '@wobox/integrations';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { contactId } = await req.json() as { contactId: string };
    if (!contactId) return NextResponse.json({ error: 'missing contactId' }, { status: 400 });

    const db = createAdminClient();

    const { data: contact, error: cErr } = await db
      .from('contacts')
      .select('id, name, role, company_id, companies(name, venture, apollo_id)')
      .eq('id', contactId)
      .single();

    if (cErr || !contact) return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 });

    const c = contact as unknown as {
      id: string;
      name: string;
      role: string | null;
      company_id: string;
      companies: { name: string; venture: string; apollo_id: string | null } | null;
    };

    const venture = (c.companies?.venture ?? 'wobox_food') as 'wobox_food' | 'wobox_fashion' | 'loop';
    const firstName = c.name.split(' ')[0] ?? c.name;
    const apolloOrgId = c.companies?.apollo_id;

    // Si tenemos el ID de la org en Apollo, buscamos el person ID exacto primero
    let personId: string | undefined;
    if (apolloOrgId) {
      // Busca sin filtro de títulos para encontrar cualquier contacto de la empresa
      const teasers = await apollo.searchDecisionMakers({
        orgId: apolloOrgId,
        titles: ['Manager', 'Director', 'CEO', 'Founder', 'Owner', 'Head', 'VP', 'Chief',
                 'Commercial', 'Gerente', 'Director', 'Presidente', 'Socio', 'Partner'],
        perPage: 25,
      });
      const match = teasers.find(
        (t) => (t.first_name ?? '').toLowerCase() === firstName.toLowerCase(),
      );
      personId = match?.id;
    }

    const person = await apollo.matchPerson({
      ...(personId ? { personId } : { firstName, organizationName: c.companies?.name ?? '' }),
      venture,
      operation: 'unlock-contact',
    });

    if (!person) return NextResponse.json({ error: 'Apollo no encontró el contacto' }, { status: 404 });
    if (!person.email) return NextResponse.json({ error: 'Apollo encontró el contacto pero no tiene email público disponible' }, { status: 404 });

    const { error: uErr } = await db
      .from('contacts')
      .update({
        email: person.email ?? null,
        linkedin_url: person.linkedin_url ?? null,
        name: person.name ?? c.name,
        role: person.title ?? c.role ?? null,
        contact_source: 'apollo (unlocked)',
      })
      .eq('id', contactId);

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    return NextResponse.json({ email: person.email, name: person.name, linkedin_url: person.linkedin_url });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
