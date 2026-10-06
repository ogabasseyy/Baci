import { describe, expect, it } from 'vitest';
import { hostedFirstCardEnvironmentSchema } from './hosted-first-card-environment';

const config = JSON.stringify({
  deployment: 'staging',
  authOrigin: 'https://staging-auth.ogabassey.com',
  publicOrigin: 'https://ogabassey.com',
  expiresAt: '2026-10-07T00:00:00Z',
  maximumAmountKobo: 5000,
});

const valid = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
  NEXT_PUBLIC_APP_URL: 'https://ogabassey.com',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  BACI_WORKER_PROFILE: 'hosted-first-card-checkout',
  PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED: 'true',
  PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: config,
};

describe('hostedFirstCardEnvironmentSchema', () => {
  it('parses a valid hosted first-card environment', () => {
    expect(hostedFirstCardEnvironmentSchema.safeParse(valid).success).toBe(
      true
    );
  });

  it('refuses amounts above the staging ceiling', () => {
    const over = JSON.parse(config) as Record<string, unknown>;
    over.maximumAmountKobo = 10_001;
    expect(
      hostedFirstCardEnvironmentSchema.safeParse({
        ...valid,
        PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: JSON.stringify(over),
      }).success
    ).toBe(false);
  });

  it('refuses inherited service credentials and a public surface', () => {
    expect(
      hostedFirstCardEnvironmentSchema.safeParse({
        ...valid,
        SUPABASE_SERVICE_ROLE_KEY: 'secret',
      }).success
    ).toBe(false);
    expect(
      hostedFirstCardEnvironmentSchema.safeParse({
        ...valid,
        PREFUNDED_CARD_PUBLIC_ENABLED: 'true',
      }).success
    ).toBe(false);
  });
});
