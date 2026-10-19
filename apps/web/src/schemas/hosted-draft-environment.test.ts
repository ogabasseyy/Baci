import { describe, expect, it } from 'vitest';
import { hostedDraftEnvironmentSchema } from './hosted-draft-environment';

const valid = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
  NEXT_PUBLIC_APP_URL: 'https://ogabassey.com',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  BACI_WORKER_PROFILE: 'hosted-savings-drafts',
  PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED: 'true',
};

describe('hostedDraftEnvironmentSchema', () => {
  it('parses a valid hosted drafts environment', () => {
    const parsed = hostedDraftEnvironmentSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('strips the staging flag from the parsed output', () => {
    const parsed = hostedDraftEnvironmentSchema.parse(valid);
    expect(parsed).not.toHaveProperty('PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED');
    expect(parsed.BACI_WORKER_PROFILE).toBe('hosted-savings-drafts');
  });

  it('rejects a wrong worker profile', () => {
    expect(
      hostedDraftEnvironmentSchema.safeParse({
        ...valid,
        BACI_WORKER_PROFILE: 'hosted-savings-funding',
      }).success
    ).toBe(false);
  });
});
