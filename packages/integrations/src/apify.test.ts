import { describe, expect, it } from 'vitest';
import { normalizeInstagramHandle } from './apify.js';

describe('normalizeInstagramHandle', () => {
  it('devuelve null para entrada vacia', () => {
    expect(normalizeInstagramHandle('')).toBe(null);
    expect(normalizeInstagramHandle('   ')).toBe(null);
  });

  it('acepta handle bare', () => {
    expect(normalizeInstagramHandle('kaldicafepalermo')).toBe('kaldicafepalermo');
    expect(normalizeInstagramHandle('@kaldicafe')).toBe('kaldicafe');
    expect(normalizeInstagramHandle('Matteo.Home')).toBe('matteo.home');
  });

  it('extrae handle de URL', () => {
    expect(normalizeInstagramHandle('https://www.instagram.com/kaldicafepalermo/')).toBe(
      'kaldicafepalermo',
    );
    expect(normalizeInstagramHandle('http://instagram.com/malcriada.arg')).toBe(
      'malcriada.arg',
    );
    expect(normalizeInstagramHandle('instagram.com/pani_soho')).toBe('pani_soho');
  });

  it('quita query string y fragment', () => {
    expect(normalizeInstagramHandle('https://instagram.com/cafe?igsh=xyz')).toBe('cafe');
  });

  it('rechaza chars invalidos', () => {
    expect(normalizeInstagramHandle('@with space')).toBe(null);
    expect(normalizeInstagramHandle('with@char')).toBe(null);
    expect(normalizeInstagramHandle('with/slash')).toBe(null);
  });

  it('permite puntos y underscores', () => {
    expect(normalizeInstagramHandle('my.cafe_shop')).toBe('my.cafe_shop');
  });
});
