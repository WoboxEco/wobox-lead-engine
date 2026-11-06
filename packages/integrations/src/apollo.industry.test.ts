import { describe, expect, it } from 'vitest';
import { normalizeIndustryName, resolveIndustryTagIds } from './apollo.js';

describe('resolveIndustryTagIds', () => {
  it('resuelve las industrias del ICP fashion desde los IDs verificados (sin red)', async () => {
    const r = await resolveIndustryTagIds(['apparel & fashion', 'Luxury Goods & Jewelry']);
    expect(r.ids).toEqual(['5567cd82736964540d0b0000', '5567cda97369644cfd3e0000']);
    expect(r.missing).toEqual([]);
  });

  it('normaliza & y mayúsculas', () => {
    expect(normalizeIndustryName('Apparel & Fashion')).toBe('apparel and fashion');
  });
});
