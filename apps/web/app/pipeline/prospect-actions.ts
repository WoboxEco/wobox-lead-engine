'use server';

import { spawn } from 'node:child_process';
import { revalidatePath } from 'next/cache';

const VENTURES = new Set(['wobox_food', 'wobox_fashion', 'loop']);
const CHANNELS = new Set(['instagram_dm', 'email', 'linkedin', 'whatsapp']);

/**
 * Corre una skill del monorepo como subproceso (el mismo CLI que en terminal).
 * Lo hacemos via subproceso y no importando la skill para evitar problemas de
 * bundling (los prompts .md se leen del disco relativo al package). El --filter
 * de pnpm resuelve el workspace desde cualquier subdirectorio.
 */
function runSkill(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolveP) => {
    const cmd = ['pnpm', '--filter', '@wobox/skills', 'run', 'skill', ...args].join(' ');
    const child = spawn(cmd, { shell: true });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', (code) => resolveP({ code: code ?? 0, out }));
    child.on('error', (e) => resolveP({ code: 1, out: String(e) }));
  });
}

/** Genera drafts (batch) para los qualified del venture elegido. */
export async function generateMessagesAction(formData: FormData): Promise<string> {
  const venture = String(formData.get('venture') ?? '');
  const channel = String(formData.get('channel') ?? 'instagram_dm');
  if (!VENTURES.has(venture)) return 'Venture inválido';
  if (!CHANNELS.has(channel)) return 'Canal inválido';

  const { code, out } = await runSkill([
    'generate-messages',
    '--all',
    `--venture=${venture}`,
    `--channel=${channel}`,
  ]);

  revalidatePath('/drafts');
  revalidatePath('/pipeline');

  const summary = out.match(/generate-messages done: .*/)?.[0];
  if (summary) return summary;
  return code === 0 ? 'Listo (ver /drafts)' : `Error: ${out.slice(-200)}`;
}

/** Sourcing nuevos leads (Apollo) + scoring, para el venture elegido. */
export async function prospectAction(formData: FormData): Promise<string> {
  const venture = String(formData.get('venture') ?? '');
  const limitRaw = Number.parseInt(String(formData.get('limit') ?? '25'), 10);
  if (!VENTURES.has(venture)) return 'Venture inválido';
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 25;

  // 1) Sourcing (search-leads usa Apollo, gasta 1 crédito)
  const search = await runSkill([
    'search-leads',
    `--venture=${venture}`,
    `--limit=${limit}`,
  ]);
  if (search.code !== 0) {
    return `Error en sourcing: ${search.out.slice(-200)}`;
  }

  // 2) Scoring de lo recién traído (new/enriched)
  await runSkill(['score-leads', '--all', `--venture=${venture}`, `--limit=${limit}`]);

  revalidatePath('/pipeline');
  revalidatePath('/');

  const searchLine = search.out.match(/search-leads done: .*/)?.[0] ?? 'sourcing ok';
  return `${searchLine} → scoreados. Ver pipeline.`;
}
