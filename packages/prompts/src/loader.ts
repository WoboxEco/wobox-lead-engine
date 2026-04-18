import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_ROOT = resolve(__dirname, '..');

export type PromptCategory = 'scoring' | 'messages';

export async function loadPrompt(
  category: PromptCategory,
  name: string,
  vars: Record<string, string | number | null | undefined> = {},
): Promise<string> {
  const path = resolve(PROMPTS_ROOT, category, `${name}.md`);
  const raw = await readFile(path, 'utf-8');

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

export function buildLeadData(company: Record<string, unknown>, contacts: Record<string, unknown>[] = []): string {
  return JSON.stringify({ company, contacts }, null, 2);
}
