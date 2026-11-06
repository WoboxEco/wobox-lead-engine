import { describe, expect, it } from 'vitest';
import { resolveEmailRecipient } from './deliver.js';

describe('resolveEmailRecipient', () => {
  it('prefiere email del contacto', () => {
    expect(
      resolveEmailRecipient({ email: 'ana@x.com', companies: { generic_email: 'info@x.com' } }),
    ).toBe('ana@x.com');
  });
  it('fallback a generic_email de la company', () => {
    expect(resolveEmailRecipient({ email: null, companies: { generic_email: 'info@x.com' } })).toBe(
      'info@x.com',
    );
  });
  it('null si no hay ninguno', () => {
    expect(resolveEmailRecipient({ email: ' ', companies: null })).toBeNull();
  });
});
