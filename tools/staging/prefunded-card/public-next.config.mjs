import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const runtimeNames = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_URL',
];

export default {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(directory, '../..'),
  assetPrefix: '/savings/card-assets',
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  typescript: { tsconfigPath: './tsconfig.json' },
  experimental: { cpus: 2 },
  webpack(config) {
    const definitions = config.plugins
      .map((plugin) => plugin.definitions)
      .filter((value) => value?.__NEXT_DEFINE_ENV);
    if (definitions.length !== 1)
      throw new Error('First-card build environment contract changed');
    for (const name of runtimeNames) {
      delete definitions[0][`process.env.${name}`];
    }
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@/env$': path.resolve(directory, 'src/public-env.ts'),
    };
    return config;
  },
};
