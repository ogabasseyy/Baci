import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'oxygen-cookie.pw.ts',
  workers: 1,
  reporter: 'list',
  outputDir:
    process.env.OXYGEN_COOKIE_BROWSER_ARTIFACTS ||
    '/tmp/baci-oxygen-cookie-results',
  use: {
    browserName: 'chromium',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-not-a-secret',
      VERCEL_ENV: 'preview',
      OXYGEN_STAGING_HOSTED_HOSTS: 'frame.example.test',
      OXYGEN_STAGING_SELFIE_HOSTS: 'frame.example.test',
    },
    command: 'pnpm exec next dev . --hostname 127.0.0.1 --port 3297',
    url: 'http://127.0.0.1:3297/inspect',
    timeout: 60000,
    reuseExistingServer: false,
  },
});
