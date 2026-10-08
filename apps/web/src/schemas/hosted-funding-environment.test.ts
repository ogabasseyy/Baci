import { describe, expect, it } from 'vitest';
import { hostedFundingEnvironmentSchema } from './hosted-funding-environment';

const valid = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
  NEXT_PUBLIC_APP_URL: 'https://ogabassey.com',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  BACI_WORKER_PROFILE: 'hosted-savings-funding',
  PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED: 'true',
  PIGGYVEST_SAVINGS_FUNDING_API_SECRET: 'secret',
  PIGGYVEST_SAVINGS_FUNDING_BUSINESS_ID: 'business',
  PIGGYVEST_SAVINGS_FUNDING_INTEGRATION_ID: 'integration',
  PIGGYVEST_SAVINGS_FUNDING_MERCHANT_ID: 'merchant',
  PIGGYVEST_SAVINGS_FUNDING_PROJECT_ID: 'project',
  PIGGYVEST_SAVINGS_FUNDING_CUSTOMER_ALLOWLIST: 'customer-1',
  PIGGYVEST_SAVINGS_FUNDING_FINGERPRINT_KEY: 'fingerprint',
  PIGGYVEST_SAVINGS_FUNDING_DB_HOST: 'localhost',
  PIGGYVEST_SAVINGS_FUNDING_DB_PORT: '5432',
  PIGGYVEST_SAVINGS_FUNDING_DB_NAME: 'funding',
  PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD: 'password',
  PIGGYVEST_SAVINGS_FUNDING_DB_CA: 'ca',
};

describe('hostedFundingEnvironmentSchema', () => {
  it('parses a valid hosted funding environment', () => {
    expect(hostedFundingEnvironmentSchema.safeParse(valid).success).toBe(true);
  });

  it('keeps server credentials out of the parsed output', () => {
    const parsed = hostedFundingEnvironmentSchema.parse(valid);
    expect(parsed).not.toHaveProperty('PIGGYVEST_SAVINGS_FUNDING_DB_PASSWORD');
    expect(parsed).not.toHaveProperty('PIGGYVEST_SAVINGS_FUNDING_API_SECRET');
    expect(parsed.BACI_WORKER_PROFILE).toBe('hosted-savings-funding');
  });

  it('rejects a missing funding secret', () => {
    const { PIGGYVEST_SAVINGS_FUNDING_API_SECRET: _dropped, ...rest } = valid;
    expect(hostedFundingEnvironmentSchema.safeParse(rest).success).toBe(false);
  });
});
