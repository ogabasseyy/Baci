import path from 'node:path';
import type { NextConfig } from 'next';

// The localhost harness imports the production schema while prerendering.
// Supply synthetic validation material; never inherit real server credentials.
Object.assign(process.env, {
  SUPABASE_SERVICE_ROLE_KEY: 'checkout-browser-fixture-not-a-credential',
  SUPABASE_JWT_SECRET: 'checkout-browser-fixture-signing-material-00000000',
  QUIZ_RPC_SERVER_SECRET: 'checkout-browser-fixture-signing-material-00000000',
});

// This app is test-only. No production routes, secrets or configuration switches.
const config: NextConfig = {
  reactCompiler: true,
  turbopack: { root: path.resolve(__dirname, '../../../../..') },
  distDir: process.env.CHECKOUT_BROWSER_DIST_DIR || '.next',
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'checkout-browser-fixture',
  },
  images: { unoptimized: true },
};
export default config;
