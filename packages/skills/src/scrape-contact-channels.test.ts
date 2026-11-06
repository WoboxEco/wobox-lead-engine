import { describe, expect, it } from 'vitest';
import {
  extractContactChannels,
  normalizeArPhone,
  pickGenericEmail,
  titleMatches,
} from './scrape-contact-channels.js';

describe('normalizeArPhone', () => {
  it('fijo CABA con 0 y guiones', () => {
    expect(normalizeArPhone('011 4777-1234')).toBe('+541147771234');
  });
  it('local CABA sin area', () => {
    expect(normalizeArPhone('4777-1234')).toBe('+541147771234');
  });
  it('celular con 15', () => {
    expect(normalizeArPhone('11 15 5555-1234')).toBe('+5491155551234');
  });
  it('E.164 movil', () => {
    expect(normalizeArPhone('+54 9 11 5555 1234')).toBe('+5491155551234');
  });
  it('interior con area de 3 digitos', () => {
    expect(normalizeArPhone('(0341) 15 444-5566')).toBe('+5493414445566');
  });
  it('rechaza basura', () => {
    expect(normalizeArPhone('123')).toBeNull();
    expect(normalizeArPhone('2024-2025')).toBeNull();
  });
});

describe('extractContactChannels', () => {
  const html = `
    <a href="https://wa.me/5491155551234?text=hola">WhatsApp</a>
    <a href="tel:+541147771234">Llamanos</a>
    <a href="https://www.instagram.com/marca.ok/">IG</a>
    <a href="mailto:juan@gmail.com">x</a>
    <p>Escribinos a ventas@marca.com.ar o info@marca.com.ar</p>
    <img src="logo@2x.png">
  `;
  it('extrae todos los canales', () => {
    expect(extractContactChannels(html, 'marca.com.ar')).toEqual({
      whatsapp: '+5491155551234',
      phone: '+541147771234',
      instagram_handle: 'marca.ok',
      generic_email: 'info@marca.com.ar',
    });
  });
  it('api.whatsapp.com sin 9 => fuerza movil', () => {
    const r = extractContactChannels(
      '<a href="https://api.whatsapp.com/send?phone=541155551234&amp;text=x">wa</a>',
      null,
    );
    expect(r.whatsapp).toBe('+5491155551234');
  });
  it('telefono en texto visible, ignora scripts', () => {
    const r = extractContactChannels(
      '<script>var id = "1147771234";</script><footer>Tel: (011) 4777-9999</footer>',
      null,
    );
    expect(r.phone).toBe('+541147779999');
  });
});

describe('pickGenericEmail', () => {
  it('sin dominio propio solo acepta mailto', () => {
    expect(
      pickGenericEmail(
        [
          { email: 'foo@otro.com', fromMailto: false },
          { email: 'tienda@gmail.com', fromMailto: true },
        ],
        'marca.com',
      ),
    ).toBe('tienda@gmail.com');
  });
});

describe('titleMatches', () => {
  it('match por inclusion', () => {
    expect(titleMatches('Muebles Bonetti S.A.', 'Bonetti Muebles - Palermo')).toBe(true);
  });
  it('no matchea otro negocio', () => {
    expect(titleMatches('Muebles Bonetti', 'Café Tortoni')).toBe(false);
  });
});
