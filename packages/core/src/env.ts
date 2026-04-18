import { config } from 'dotenv';
import { z } from 'zod';

config({ path: ['.env.local', '.env'] });

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-5'),

  APOLLO_API_KEY: z.string().min(1).optional(),
  APOLLO_BASE_URL: z.string().url().default('https://api.apollo.io/v1'),

  APIFY_API_TOKEN: z.string().min(1).optional(),
  APIFY_ACTOR_GOOGLE_MAPS: z.string().default('compass/crawler-google-places'),
  APIFY_ACTOR_INSTAGRAM: z.string().default('apify/instagram-profile-scraper'),

  HUBSPOT_PRIVATE_APP_TOKEN: z.string().min(1).optional(),

  CALENDLY_SIGNING_KEY: z.string().min(1).optional(),

  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
