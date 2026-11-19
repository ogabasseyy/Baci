import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  isProviderCoolingDown,
  recordProviderFailure,
} from '@/ai/provider-cooldown';
import { installSharedTestSetup } from './vitest.setup.shared';

const PROVIDER = 'shared-setup-contract-test';

// The project's setup file has already called installSharedTestSetup(). Calling
// it again inside a describe adds a second, describe-scoped set of hooks with
// its own counter, so each case below can be asserted from a known start.
describe('installSharedTestSetup deterministic UUIDs', () => {
  installSharedTestSetup();

  it('starts a counter-based v4 sequence at zero', () => {
    expect(crypto.randomUUID()).toBe('00000000-0000-4000-8000-000000000000');
    expect(crypto.randomUUID()).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('keeps counting across tests instead of restarting', () => {
    expect(crypto.randomUUID()).toBe('00000000-0000-4000-8000-000000000002');
  });
});

describe('installSharedTestSetup provider cooldowns', () => {
  installSharedTestSetup();

  it('lets a test park a provider after a rate-limit rejection', () => {
    recordProviderFailure(PROVIDER, new Error('rate limit exceeded'));

    expect(isProviderCoolingDown(PROVIDER)).toBe(true);
  });

  it('clears every cooldown before the next test', () => {
    expect(isProviderCoolingDown(PROVIDER)).toBe(false);
  });
});

describe('installSharedTestSetup environment defaults', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://custom.example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined);
  installSharedTestSetup();

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('keeps a value that is already set', () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://custom.example');
  });

  it('fills in a mock value when the variable is missing', () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('mock-anon-key');
  });
});
