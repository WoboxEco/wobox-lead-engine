import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@wobox/core'],
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
