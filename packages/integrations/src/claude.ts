import Anthropic from '@anthropic-ai/sdk';
import { env, createAdminClient, type Venture } from '@wobox/core';
import pRetry from 'p-retry';
import type { ZodSchema } from 'zod';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

export interface CompleteJsonParams<T> {
  system: string;
  user: string;
  schema: ZodSchema<T>;
  venture?: Venture;
  operation: string;
  maxTokens?: number;
}

export async function completeJson<T>(params: CompleteJsonParams<T>): Promise<T> {
  const c = getClient();
  const model = env().CLAUDE_MODEL;
  const maxTokens = params.maxTokens ?? 2048;

  const response = await pRetry(
    async () => {
      return c.messages.create({
        model,
        max_tokens: maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: params.user }],
      });
    },
    { retries: 3, minTimeout: 1000, factor: 2 },
  );

  await trackUsage({
    operation: params.operation,
    venture: params.venture,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude response did not contain JSON: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return params.schema.parse(parsed);
}

export async function completeText(params: {
  system: string;
  user: string;
  venture?: Venture;
  operation: string;
  maxTokens?: number;
}): Promise<string> {
  const c = getClient();
  const model = env().CLAUDE_MODEL;
  const maxTokens = params.maxTokens ?? 1024;

  const response = await pRetry(
    async () => {
      return c.messages.create({
        model,
        max_tokens: maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: params.user }],
      });
    },
    { retries: 3, minTimeout: 1000, factor: 2 },
  );

  await trackUsage({
    operation: params.operation,
    venture: params.venture,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function trackUsage(params: {
  operation: string;
  venture?: Venture;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  try {
    const db = createAdminClient();
    await db.from('api_usage').insert({
      service: 'claude',
      operation: params.operation,
      credits_used: 0,
      tokens_used: params.inputTokens + params.outputTokens,
      venture: params.venture ?? null,
    });
  } catch {
    // silent fail: tracking no debe romper la skill
  }
}
