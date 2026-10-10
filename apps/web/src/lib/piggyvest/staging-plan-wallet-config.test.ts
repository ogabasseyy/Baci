import { describe, expect, it } from 'vitest';
import { stagingPlanWalletConfig } from './staging-plan-wallet-config';

describe('stagingPlanWalletConfig', () => {
  const config = {
    baseUrl: 'https://staging.piggyvest.business',
    token: 'synthetic-test-token',
  };

  it('accepts the exact sandbox origin outside production', () => {
    expect(stagingPlanWalletConfig(config, 'preview')).toEqual(config);
  });

  it('rejects production even with sandbox credentials', () => {
    expect(stagingPlanWalletConfig(config, 'production')).toBeNull();
  });

  it.each([
    undefined,
    'https://api.piggyvest.business',
    'http://staging.piggyvest.business',
    'https://staging.piggyvest.business.attacker.invalid',
    'https://staging.piggyvest.business/path',
    'https://user:pass@staging.piggyvest.business',
  ])('rejects missing or unreviewed origin %s', (baseUrl) => {
    expect(
      stagingPlanWalletConfig({ ...config, baseUrl }, 'preview')
    ).toBeNull();
  });

  it('rejects absent configuration and empty credentials', () => {
    expect(stagingPlanWalletConfig(null, 'preview')).toBeNull();
    expect(
      stagingPlanWalletConfig({ ...config, token: ' ' }, 'preview')
    ).toBeNull();
  });
});
