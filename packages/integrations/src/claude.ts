import Anthropic from '@anthropic-ai/sdk';
import { type Venture, createAdminClient, env } from '@wobox/core';
import pRetry from 'p-retry';
import type { ZodSchema } from 'zod';

// Alias cortos para el flag --model en la CLI.
// Default queda en env().CLAUDE_MODEL (Sonnet 4.5).
const MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5',
  opus: 'claude-opus-4-5',
};

export function resolveModel(modelOrAlias?: string): string {
  if (!modelOrAlias) return env().CLAUDE_MODEL;
  return MODEL_ALIASES[modelOrAlias] ?? modelOrAlias;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

export interface CompleteJsonParams<T> {
  system: string;
  user: string;
  cachedPrefix?: string;
  schema: ZodSchema<T>;
  venture?: Venture;
  operation: string;
  maxTokens?: number;
  model?: string;
}

export async function completeJson<T>(params: CompleteJsonParams<T>): Promise<T> {
  const c = getClient();
  const model = resolveModel(params.model);
  const maxTokens = params.maxTokens ?? 2048;

  const response = await pRetry(
    async () => {
      return c.messages.create({
        model,
        max_tokens: maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: buildUserContent(params.cachedPrefix, params.user) }],
      });
    },
    { retries: 3, minTimeout: 1000, factor: 2 },
  );

  const usage = response.usage as {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };

  await trackUsage({
    operation: params.operation,
    model,
    ...(params.venture ? { venture: params.venture } : {}),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
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
  cachedPrefix?: string;
  venture?: Venture;
  operation: string;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const c = getClient();
  const model = resolveModel(params.model);
  const maxTokens = params.maxTokens ?? 1024;

  const response = await pRetry(
    async () => {
      return c.messages.create({
        model,
        max_tokens: maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: buildUserContent(params.cachedPrefix, params.user) }],
      });
    },
    { retries: 3, minTimeout: 1000, factor: 2 },
  );

  const usage = response.usage as {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };

  await trackUsage({
    operation: params.operation,
    model,
    ...(params.venture ? { venture: params.venture } : {}),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('');
}

function buildUserContent(
  cachedPrefix: string | undefined,
  user: string,
): Anthropic.TextBlockParam[] {
  if (!cachedPrefix) return [{ type: 'text', text: user }];
  return [
    { type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: user },
  ];
}

async function trackUsage(params: {
  operation: string;
  model: string;
  venture?: Venture;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): Promise<void> {
  try {
    const db = createAdminClient();
    // Total tokens = input (non-cached) + cache writes + cache reads + output.
    // Cache stats quedan en operation suffix: "::cache=W/R" para show-metrics.
    const cacheSuffix =
      params.cacheCreationTokens > 0 || params.cacheReadTokens > 0
        ? `::cache=${params.cacheCreationTokens}/${params.cacheReadTokens}`
        : '';
    await db.from('api_usage').insert({
      service: 'claude',
      operation: `${params.operation}::${params.model}${cacheSuffix}`,
      credits_used: 0,
      tokens_used:
        params.inputTokens +
        params.outputTokens +
        params.cacheCreationTokens +
        params.cacheReadTokens,
      venture: params.venture ?? null,
    });
  } catch {
    // silent fail: tracking no debe romper la skill
  }
}
