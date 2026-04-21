import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../packages/core/src/index.js';

async function main() {
  const client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  const promptPath = resolve('packages/prompts/scoring/scoring-loop-v1.md');
  const raw = readFileSync(promptPath, 'utf-8');
  const marker = '{{LEAD_DATA}}';
  const idx = raw.indexOf(marker);
  const stable = raw.slice(0, idx);
  console.log(
    `stable prefix chars: ${stable.length}  (~${Math.round(stable.length / 4)} tokens aprox)`,
  );

  const leadData = JSON.stringify({
    company: { name: 'Test Cafe', venture: 'loop', region: 'CABA', neighborhood: 'Palermo' },
    contacts: [],
  });

  console.log('\n--- Call 1 (should write cache) ---');
  const res1 = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: 'Responde SOLO JSON valido.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `Datos:\n${leadData}` },
        ],
      },
    ],
  });
  console.log('usage:', JSON.stringify(res1.usage, null, 2));

  console.log('\n--- Call 2 (should hit cache) ---');
  const res2 = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: 'Responde SOLO JSON valido.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
          {
            type: 'text',
            text: `Datos:\n${JSON.stringify({ company: { name: 'Otro Cafe' }, contacts: [] })}`,
          },
        ],
      },
    ],
  });
  console.log('usage:', JSON.stringify(res2.usage, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
