import { describe, expect, it } from 'vitest';
import { formatFailures, formatGenerateSummary } from './summary.js';

describe('formatFailures', () => {
  it('un solo motivo', () => {
    const f = Array.from({ length: 6 }, () => ({
      reason: 'Prompt not found: messages/message-wobox-warm-intro-fashion-v1',
    }));
    expect(formatFailures(f)).toBe(
      '6 fallaron: Prompt not found: messages/message-wobox-warm-intro-fashion-v1',
    );
  });
  it('varios motivos, ordenados por frecuencia', () => {
    expect(formatFailures([{ reason: 'a' }, { reason: 'b' }, { reason: 'b' }])).toBe(
      '3 fallaron: 2 b; 1 a',
    );
  });
  it('sin fallos', () => expect(formatFailures([])).toBe(''));
});

describe('formatGenerateSummary', () => {
  it('email con reveals y fallos agrupados', () => {
    expect(
      formatGenerateSummary({
        channel: 'email',
        ok: 2,
        noEmail: 5,
        noContacts: 8,
        failures: [{ reason: 'timeout' }],
        revealed: 1,
        credits: 3,
        revealFailures: [{ reason: 'apollo_sin_email_previo' }, { reason: 'sin_contactos' }],
      }),
    ).toBe(
      '2 drafts, 1 emails revelados (3 créditos), 5 sin email (motivos: 1 Apollo sin email (intento previo)), 8 sin contactos, 1 fallaron: timeout (máx 10 reveals por corrida)',
    );
  });
  it('otros canales', () => {
    expect(
      formatGenerateSummary({
        channel: 'linkedin',
        ok: 3,
        noEmail: 0,
        noContacts: 0,
        failures: [],
      }),
    ).toBe('3 drafts (ver /drafts)');
  });
});
