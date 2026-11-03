import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

function findMonorepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const ROOT = findMonorepoRoot();
config({ path: [resolve(ROOT, '.env.local'), resolve(ROOT, '.env')] });

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-5'),

  APOLLO_API_KEY: z.string().min(1).optional(),
  APOLLO_BASE_URL: z.string().url().default('https://api.apollo.io/v1'),

  APIFY_API_TOKEN: z.string().min(1).optional(),
  APIFY_ACTOR_GOOGLE_MAPS: z.string().default('compass/crawler-google-places'),
  APIFY_ACTOR_INSTAGRAM: z.string().default('apify/instagram-profile-scraper'),

  HUBSPOT_PRIVATE_APP_TOKEN: z.string().min(1).optional(),

  CALENDLY_SIGNING_KEY: z.string().min(1).optional(),

  GMAIL_USER: z.string().email().optional(),
  GMAIL_APP_PASSWORD: z.string().min(1).optional(),
  EMAIL_FROM_NAME: z.string().default('Sebastián | Wobox'),
  EMAIL_DAILY_LIMIT: z.coerce.number().int().positive().default(40),

  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
  );
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
