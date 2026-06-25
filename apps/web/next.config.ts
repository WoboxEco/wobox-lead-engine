import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

// Cargar .env del root del monorepo (Next solo busca en apps/web/ por default).
loadDotenv({ path: resolve(__dirname, '../../.env') });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@wobox/core', '@wobox/skills', '@wobox/prompts', '@wobox/integrations'],
  // Incluye los .md de prompts en el output de Vercel (file tracing los omite por default)
  outputFileTracingIncludes: {
    '/app/pipeline/page': ['../../packages/prompts/**/*.md'],
    '/app/drafts/page': ['../../packages/prompts/**/*.md'],
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  },
  webpack: (cfg) => {
    // ESM imports en @wobox/core usan extensiones .js explicitas que apuntan a fuentes .ts.
    // extensionAlias le dice a webpack: cuando veas .js, probá .ts primero.
    cfg.resolve ??= {};
    cfg.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return cfg;
  },
};

export default config;
