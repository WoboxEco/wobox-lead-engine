import { describe, expect, it } from 'vitest';
import {
  EXHAUSTED_MESSAGE,
  type SearchLeadsResult,
  formatProspectSummary,
  isProspectRegion,
} from './prospect-summary.js';

const base: SearchLeadsResult = {
  inserted: 7,
  duplicates: 18,
  filteredOut: 5,
  pagesFetched: 2,
  page: 3,
  totalPages: 12,
  credits: 2,
  exhausted: false,
  contactsAdded: 0,
  insertedIds: [],
};

describe('formatProspectSummary', () => {
  it('arma el resumen completo', () => {
    expect(formatProspectSummary(base, 4)).toBe(
      '7 nuevos, 18 duplicados, 5 filtrados por rubro, 4 calificados — página 3 de 12 (2 créditos)',
    );
  });

  it('omite calificados si no hubo scoring y singular de crédito', () => {
    expect(formatProspectSummary({ ...base, credits: 1 }, null)).toBe(
      '7 nuevos, 18 duplicados, 5 filtrados por rubro — página 3 de 12 (1 crédito)',
    );
  });

  it('avisa cuando se agotó', () => {
    expect(formatProspectSummary({ ...base, inserted: 0, exhausted: true }, 0)).toContain(
      EXHAUSTED_MESSAGE,
    );
  });
});

describe('isProspectRegion', () => {
  it('acepta solo regiones del selector', () => {
    expect(isProspectRegion('Argentina')).toBe(true);
    expect(isProspectRegion('Córdoba, Argentina')).toBe(true);
    expect(isProspectRegion('Chile')).toBe(false);
  });
});
