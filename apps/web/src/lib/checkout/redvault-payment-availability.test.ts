import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRedvaultPaymentAvailability } from './redvault-payment-availability';

describe('REDVAULT payment availability', () => {
  afterEach(() => vi.unstubAllEnvs());

  function isolatedTestSettings() {
    vi.stubEnv('BACI_RUNTIME_ENV', 'staging');
    vi.stubEnv('REDVAULT_STAGING_TEST_ENABLED', 'true');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv(
      'REDVAULT_STAGING_SUPABASE_URL',
      'https://redvault-test.supabase.co'
    );
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://redvault-test.supabase.co');
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_fixture');
  }

  it('exposes the option only for the explicit staging test gate', () => {
    isolatedTestSettings();

    expect(getRedvaultPaymentAvailability()).toEqual({
      available: true,
      reason: 'staging_test_mode',
    });
  });

  it('does not expose the option when the runtime is not staging', () => {
    isolatedTestSettings();
    vi.stubEnv('BACI_RUNTIME_ENV', 'production');

    expect(getRedvaultPaymentAvailability()).toEqual({
      available: false,
      reason: 'provider_evidence_unavailable',
    });
  });

  it('rejects a production Vercel deployment even with staging flags and test keys', () => {
    isolatedTestSettings();
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(getRedvaultPaymentAvailability().available).toBe(false);
  });

  it('permits a local development test against loopback Supabase', () => {
    isolatedTestSettings();
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('REDVAULT_STAGING_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');

    expect(getRedvaultPaymentAvailability().available).toBe(true);
  });

  it('does not expose a chargeable option without provider evidence', () => {
    isolatedTestSettings();
    vi.stubEnv('BACI_RUNTIME_ENV', '');
    vi.stubEnv('REDVAULT_STAGING_TEST_ENABLED', '');

    expect(getRedvaultPaymentAvailability()).toEqual({
      available: false,
      reason: 'provider_evidence_unavailable',
    });
  });

  it('rejects the live Baci database even when staging flags are enabled', () => {
    isolatedTestSettings();
    vi.stubEnv(
      'REDVAULT_STAGING_SUPABASE_URL',
      'https://aivqthbxdshhltbwipbr.supabase.co'
    );
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://aivqthbxdshhltbwipbr.supabase.co'
    );

    expect(getRedvaultPaymentAvailability().available).toBe(false);
  });

  it.each([
    'sk_live_fixture',
    '',
    'invalid',
  ])('rejects a non-test Paystack secret %s', (key) => {
    isolatedTestSettings();
    vi.stubEnv('PAYSTACK_SECRET_KEY', key);

    expect(getRedvaultPaymentAvailability().available).toBe(false);
  });

  it('rejects a mismatched staging database setting', () => {
    isolatedTestSettings();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://some-other-db.supabase.co');

    expect(getRedvaultPaymentAvailability().available).toBe(false);
  });
});
