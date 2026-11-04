import { describe, expect, it } from 'vitest';
import { hasEmail, selectContact, selectEmailContact } from './contact-selection.js';

describe('selectEmailContact', () => {
  it('decision-maker con email gana sobre otro con email', () => {
    const r = selectEmailContact([
      { id: 'a', email: 'a@x.com', is_decision_maker: false },
      { id: 'dm', email: 'dm@x.com', is_decision_maker: true },
    ]);
    expect(r.contact?.id).toBe('dm');
    expect(r.hasEmail).toBe(true);
  });

  it('contacto con email gana sobre decision-maker sin email (caso Amphora)', () => {
    const r = selectEmailContact([
      { id: 'rita', email: null, is_decision_maker: true },
      { id: 'karina', email: 'rpacheco@amphora.com.ar', is_decision_maker: false },
    ]);
    expect(r.contact?.id).toBe('karina');
    expect(r.hasEmail).toBe(true);
  });

  it('sin emails: decision-maker para revelar', () => {
    const r = selectEmailContact([
      { id: 'a', email: null, is_decision_maker: false },
      { id: 'dm', email: '', is_decision_maker: true },
    ]);
    expect(r.contact?.id).toBe('dm');
    expect(r.hasEmail).toBe(false);
  });

  it('sin emails ni decision-maker: primer contacto', () => {
    const r = selectEmailContact([
      { id: 'a', email: '   ' },
      { id: 'b', email: null },
    ]);
    expect(r.contact?.id).toBe('a');
    expect(r.hasEmail).toBe(false);
  });

  it('sin contactos', () => {
    expect(selectEmailContact([])).toEqual({ contact: null, hasEmail: false });
    expect(selectEmailContact(null)).toEqual({ contact: null, hasEmail: false });
  });
});

describe('selectContact', () => {
  const contacts = [
    { id: 'dm', email: null, is_decision_maker: true },
    { id: 'b', email: 'b@x.com', is_decision_maker: false },
  ];

  it('email prioriza el contacto con email', () => {
    expect(selectContact(contacts, { channel: 'email' })?.id).toBe('b');
  });

  it('otros canales: decision-maker', () => {
    expect(selectContact(contacts, { channel: 'linkedin' })?.id).toBe('dm');
  });

  it('preferId manda', () => {
    expect(selectContact(contacts, { channel: 'email', preferId: 'dm' })?.id).toBe('dm');
    expect(selectContact(contacts, { channel: 'email', preferId: 'zzz' })).toBeNull();
  });
});

describe('hasEmail', () => {
  it('ignora vacíos y espacios', () => {
    expect(hasEmail({ id: 'x', email: ' ' })).toBe(false);
    expect(hasEmail({ id: 'x', email: 'a@b.c' })).toBe(true);
    expect(hasEmail(null)).toBe(false);
  });
});
