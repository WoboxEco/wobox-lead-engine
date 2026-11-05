import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('bundled.generated.ts', () => {
  it('está sincronizado con los .md (si falla: pnpm prompts:bundle)', async () => {
    // @ts-expect-error: script .mjs sin tipos
    const { renderBundle } = await import('../scripts/bundle-prompts.mjs');
    const expected = await renderBundle();
    const actual = await readFile(resolve(here, 'bundled.generated.ts'), 'utf-8');
    expect(actual).toBe(expected);
  });
});

describe('loadPrompt sin .md en disco (como en Vercel)', () => {
  it('usa el bundle embebido', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', () => ({
      readFile: async (p: string) => {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), {
          code: 'ENOENT',
        });
      },
    }));
    const { loadPrompt } = await import('./loader.js');
    const text = await loadPrompt('messages', 'message-wobox-warm-intro-fashion-v1', {
      COMPANY_NAME: 'Jackie Smith',
      CONNECTOR_NAME: 'Ana',
      CONTACT_NAME: 'Rosa',
      CONTACT_ROLE: 'CEO',
      LOCATIONS_COUNT: '3',
      PROFILE_INSIGHT: 'n/a',
      TODAY: '2026-11-05',
      VERTICAL: 'fashion',
    });
    expect(text).toContain('Jackie Smith');
    await expect(loadPrompt('messages', 'no-existe-v1')).rejects.toThrow(
      'Prompt not found: messages/no-existe-v1',
    );
    vi.doUnmock('node:fs/promises');
  });
});
