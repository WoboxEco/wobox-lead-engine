import { describe, expect, it } from 'vitest';
import { type Contact, selectApproach } from './generate-messages.js';

const baseContact: Contact = {
  id: 'c1',
  name: 'Juan Perez',
};

describe('selectApproach', () => {
  it('warm_path=direct -> warm_intro', () => {
    const c: Contact = { ...baseContact, warm_path: 'direct' };
    expect(selectApproach(c, 40)).toBe('warm_intro');
    expect(selectApproach(c, 95)).toBe('warm_intro');
  });

  it('warm_path=2nd_degree -> warm_intro', () => {
    const c: Contact = { ...baseContact, warm_path: '2nd_degree' };
    expect(selectApproach(c, 60)).toBe('warm_intro');
  });

  it('sin warm + score >= 80 -> direct', () => {
    expect(selectApproach(baseContact, 80)).toBe('direct');
    expect(selectApproach(baseContact, 95)).toBe('direct');
  });

  it('sin warm + score < 80 -> nurture', () => {
    expect(selectApproach(baseContact, 79)).toBe('nurture');
    expect(selectApproach(baseContact, 50)).toBe('nurture');
    expect(selectApproach(baseContact, undefined)).toBe('nurture');
  });

  it('warm_path=none se trata como sin warm', () => {
    const c: Contact = { ...baseContact, warm_path: 'none' };
    expect(selectApproach(c, 85)).toBe('direct');
    expect(selectApproach(c, 60)).toBe('nurture');
  });
});
