import { describe, expect, it } from 'vitest';
import { prefundedCardPublicRuntimeFixture } from '@/lib/piggyvest/prefunded-card-public-runtime.test-fixture';
import { prefundedCardPublicRuntimeSchemas as schemas } from './prefunded-card-public-runtime';

describe('public card runtime schema', () => {
  it('accepts only dedicated staging auth, physical database and customer surface', () => {
    expect(
      schemas.configuration.safeParse(prefundedCardPublicRuntimeFixture())
        .success
    ).toBe(true);
  });

  it('accepts the exact October 6 lease without widening runtime scope', () => {
    const fixture = prefundedCardPublicRuntimeFixture();
    fixture.expiresAt = '2026-10-06T15:59:10Z';
    expect(schemas.configuration.safeParse(fixture).success).toBe(true);
  });

  it.each([
    { deployment: 'production' },
    { expiresAt: '2099-01-01T00:00:00Z' },
    { expiresAt: '2026-10-07T00:00:00Z' },
    { publicOrigin: 'https://ogabassey.com' },
    { authOrigin: 'https://production.supabase.co' },
    { provider: { paystackSecret: 'never-needed-here' } },
  ])('rejects environment widening and provider credentials %j', (change) => {
    expect(
      schemas.configuration.safeParse({
        ...prefundedCardPublicRuntimeFixture(),
        ...change,
      }).success
    ).toBe(false);
  });

  it.each([
    { profile: 'worker' },
    { expectedSystemId: '123' },
    { transport: 'local_test' },
    { actualProjectId: 'different' },
    { login: 'service_role', expectedLogin: 'service_role' },
  ])('rejects wrong database identity or role %j', (change) => {
    const fixture = prefundedCardPublicRuntimeFixture();
    expect(
      schemas.configuration.safeParse({
        ...fixture,
        database: { ...fixture.database, ...change },
      }).success
    ).toBe(false);
  });

  it('rejects internally consistent database config for a different context project', () => {
    const fixture = prefundedCardPublicRuntimeFixture();
    fixture.database.expectedProjectId = 'another';
    fixture.database.actualProjectId = 'another';
    expect(schemas.configuration.safeParse(fixture).success).toBe(false);
  });
});
