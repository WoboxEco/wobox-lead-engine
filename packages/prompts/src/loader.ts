import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_PROMPTS } from './bundled.generated.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_ROOT = resolve(__dirname, '..');

export type PromptCategory = 'scoring' | 'messages' | 'replies';

/**
 * Texto crudo del prompt. Lee el .md del disco (así editar un prompt se ve al toque en la
 * CLI) y si no está cae al bundle embebido en el código (`bundled.generated.ts`).
 * En Vercel el path de disco es el de build (/vercel/path0/...) y no existe en runtime:
 * sin el bundle `loadPrompt` tiraba ENOENT y fallaban todos los drafts.
 */
export async function readPromptSource(category: PromptCategory, name: string): Promise<string> {
  const path = resolve(PROMPTS_ROOT, category, `${name}.md`);
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
  }
  const bundled = BUNDLED_PROMPTS[`${category}/${name}`];
  if (bundled === undefined) throw new Error(`Prompt not found: ${category}/${name}`);
  return bundled;
}

export async function loadPrompt(
  category: PromptCategory,
  name: string,
  vars: Record<string, string | number | null | undefined> = {},
): Promise<string> {
  const raw = await readPromptSource(category, name);

  const rendered = raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      throw new Error(`Prompt "${name}" missing required var: ${key}`);
    }
    return String(value);
  });

  const missing = rendered.match(/\{\{(\w+)\}\}/g);
  if (missing) {
    throw new Error(`Prompt "${name}" still has unresolved vars: ${missing.join(', ')}`);
  }

  return rendered;
}

export function buildLeadData(
  company: Record<string, unknown>,
  contacts: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ company, contacts }, null, 2);
}

/**
 * Carga un prompt y lo parte en 2: la parte estable (cacheable) y la parte variable.
 * Hidrata todas las vars EXCEPTO la del marker, que queda como variable.
 * Uso tipico: scoring donde el template es identico y solo cambia LEAD_DATA por lead.
 */
export async function loadPromptSplit(
  category: PromptCategory,
  name: string,
  stableVars: Record<string, string | number | null | undefined>,
  variableKey: string,
  variableValue: string,
): Promise<{ stable: string; variable: string }> {
  const raw = await readPromptSource(category, name);

  // Hidrata todas excepto variableKey.
  const hydrated = raw.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key === variableKey) return match;
    const value = stableVars[key];
    if (value === undefined || value === null) {
      throw new Error(`Prompt "${name}" missing stable var: ${key}`);
    }
    return String(value);
  });

  const marker = `{{${variableKey}}}`;
  const idx = hydrated.indexOf(marker);
  if (idx < 0) throw new Error(`Prompt "${name}" no contiene marker {{${variableKey}}}`);

  const stable = hydrated.slice(0, idx);
  const trailing = hydrated.slice(idx + marker.length);

  return {
    stable,
    variable: variableValue + trailing,
  };
}
