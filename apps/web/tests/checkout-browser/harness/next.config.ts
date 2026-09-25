import path from 'node:path';
import type { NextConfig } from 'next';

// This app is test-only. No production routes, secrets or configuration switches.
const config: NextConfig = {
  reactCompiler: true,
  turbopack: { root: path.resolve(__dirname, '../../../../..') },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'checkout-browser-fixture',
  },
  images: { unoptimized: true },
};
export default config;
