import { describe, expect, it } from 'vitest';
import { extractInstagramHandle } from './enrich-lead.js';

describe('extractInstagramHandle', () => {
  it('extrae handle de anchor href tipico', () => {
    const html = '<a href="https://www.instagram.com/kaldicafe/">Follow us</a>';
    expect(extractInstagramHandle(html)).toBe('kaldicafe');
  });

  it('extrae handle sin www', () => {
    const html = '<a href="https://instagram.com/pani_soho">@pani_soho</a>';
    expect(extractInstagramHandle(html)).toBe('pani_soho');
  });

  it('extrae primer handle si hay varios', () => {
    const html = `
      <a href="https://instagram.com/cafea">A</a>
      <a href="https://instagram.com/cafeb">B</a>
    `;
    expect(extractInstagramHandle(html)).toBe('cafea');
  });

  it('ignora paths genericos de IG', () => {
    const html = `
      <a href="https://instagram.com/share">Share</a>
      <a href="https://instagram.com/explore">Explore</a>
      <a href="https://instagram.com/mi.cafe">Mi cafe</a>
    `;
    expect(extractInstagramHandle(html)).toBe('mi.cafe');
  });

  it('devuelve null si no hay link IG', () => {
    expect(extractInstagramHandle('<p>Hola mundo</p>')).toBe(null);
    expect(extractInstagramHandle('')).toBe(null);
  });

  it('permite guiones, puntos y underscore', () => {
    const html = '<a href="https://instagram.com/la.fuga_palermo">link</a>';
    expect(extractInstagramHandle(html)).toBe('la.fuga_palermo');
  });

  it('ignora handles demasiado cortos', () => {
    const html = '<a href="https://instagram.com/a">x</a><a href="https://instagram.com/cafe">y</a>';
    expect(extractInstagramHandle(html)).toBe('cafe');
  });
});
