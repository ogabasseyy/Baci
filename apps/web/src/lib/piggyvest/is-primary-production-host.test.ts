import { describe, expect, it } from 'vitest';
import { isPrimaryProductionHost } from './is-primary-production-host';

describe('isPrimaryProductionHost', () => {
  it('preserves the existing production Vercel host', () => {
    expect(isPrimaryProductionHost({ VERCEL_ENV: 'production' })).toBe(true);
  });

  it('accepts explicitly scoped VPS production configuration', () => {
    expect(
      isPrimaryProductionHost({
        NODE_ENV: 'production',
        PIGGYVEST_PRIMARY_EXECUTION_HOST: 'vps',
        PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
      })
    ).toBe(true);
  });

  it.each([
    {},
    { VERCEL_ENV: 'preview' },
    { PIGGYVEST_PRIMARY_EXECUTION_HOST: 'unknown', VERCEL_ENV: 'production' },
    { NODE_ENV: 'production', PIGGYVEST_PRIMARY_EXECUTION_HOST: 'vps' },
    {
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_EXECUTION_HOST: 'vps',
      PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
    },
    {
      NODE_ENV: 'production',
      PIGGYVEST_PRIMARY_EXECUTION_HOST: 'vps',
      PIGGYVEST_PRIMARY_ENVIRONMENT: 'staging',
    },
    {
      NODE_ENV: 'production',
      PIGGYVEST_PRIMARY_EXECUTION_HOST: 'vps',
      PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
      VERCEL_ENV: 'preview',
    },
    {
      NODE_ENV: 'production',
      PIGGYVEST_PRIMARY_EXECUTION_HOST: 'vps',
      PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
      VERCEL_ENV: 'production',
    },
  ])('rejects unbound, nonproduction or contradictory host claims', (env) => {
    expect(isPrimaryProductionHost(env)).toBe(false);
  });
});
