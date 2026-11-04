import { afterEach, expect, it, vi } from 'vitest';
import { isOxygenStorefrontStagingEnabled } from './oxygen-storefront-staging';

afterEach(() => vi.unstubAllEnvs());
it('offers Oxygen only for explicit local staging with a loopback backend', () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT', 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3451');
  expect(isOxygenStorefrontStagingEnabled()).toBe(true);
  vi.stubEnv('NODE_ENV', 'production');
  expect(isOxygenStorefrontStagingEnabled()).toBe(false);
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://production.supabase.co');
  expect(isOxygenStorefrontStagingEnabled()).toBe(false);
});
