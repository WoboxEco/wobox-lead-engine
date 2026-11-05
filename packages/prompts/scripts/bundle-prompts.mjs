#!/usr/bin/env node
// Genera src/bundled.generated.ts con el contenido de todos los prompts (.md).
//
// Por qué: en Vercel el bundle de Next hornea el path absoluto de build del loader
// (file:///vercel/path0/...) y los .md no siempre quedan en el trace de la función, así que
// `readFile` da ENOENT. Embebiendo el texto en el JS el prompt viaja siempre con el código.
//
// Uso: pnpm prompts:bundle (también corre antes de `next build`). El test
// bundled.test.ts falla si el archivo generado quedó desactualizado.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = ['messages', 'scoring'];
const OUT = join(ROOT, 'src', 'bundled.generated.ts');

export async function renderBundle() {
  const entries = [];
  for (const cat of CATEGORIES) {
    const files = (await readdir(join(ROOT, cat))).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) {
      const key = relative(ROOT, join(ROOT, cat, f.replace(/\.md$/, ''))).replaceAll('\\', '/');
      entries.push([key, await readFile(join(ROOT, cat, f), 'utf-8')]);
    }
  }
  const body = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  return [
    '// ARCHIVO GENERADO por packages/prompts/scripts/bundle-prompts.mjs — no editar a mano.',
    '// Fuente de verdad: packages/prompts/<categoria>/*.md. Regenerar con `pnpm prompts:bundle`.',
    'export const BUNDLED_PROMPTS: Readonly<Record<string, string>> = {',
    body,
    '};',
    '',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(OUT, await renderBundle());
  console.log(`prompts bundle: ${relative(process.cwd(), OUT)}`);
}
