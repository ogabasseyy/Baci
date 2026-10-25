import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { resolveImeiProviderBinding } from './tier-bindings';

describe('resolveImeiProviderBinding', () => {
  const petrockEnabledTiers = new Set(['blacklist', 'simLock'] as const);

  it('falls back to Sickw when Petrock is globally disabled', () => {
    expect(
      resolveImeiProviderBinding({
        clientSupportsAsync: true,
        deviceCategory: 'smartphone',
        petrockEnabled: false,
        petrockEnabledTiers,
        tier: IMEI_SERVICE_TIERS.blacklist,
        tierKey: 'blacklist',
      })
    ).toMatchObject({
      productId: IMEI_SERVICE_TIERS.blacklist.providerServiceId,
      provider: 'sickw',
    });
  });

  it('falls back to Sickw for clients without the async capability', () => {
    expect(
      resolveImeiProviderBinding({
        clientSupportsAsync: false,
        deviceCategory: 'smartphone',
        petrockEnabled: true,
        petrockEnabledTiers,
        tier: IMEI_SERVICE_TIERS.blacklist,
        tierKey: 'blacklist',
      })?.provider
    ).toBe('sickw');
  });

  it('blocks the rejected blacklist product even when explicitly allowlisted', () => {
    expect(
      resolveImeiProviderBinding({
        clientSupportsAsync: true,
        deviceCategory: 'smartphone',
        petrockEnabled: true,
        petrockEnabledTiers,
        tier: IMEI_SERVICE_TIERS.blacklist,
        tierKey: 'blacklist',
      })
    ).toMatchObject({
      productId: IMEI_SERVICE_TIERS.blacklist.providerServiceId,
      provider: 'sickw',
    });
  });

  it('keeps a non-allowlisted tier on Sickw', () => {
    expect(
      resolveImeiProviderBinding({
        clientSupportsAsync: true,
        deviceCategory: 'smartphone',
        petrockEnabled: true,
        petrockEnabledTiers,
        tier: IMEI_SERVICE_TIERS.samsung,
        tierKey: 'samsung',
      })?.provider
    ).toBe('sickw');
  });

  it('fails closed for a Petrock-only dark tier even when allowlisted', () => {
    expect(
      resolveImeiProviderBinding({
        clientSupportsAsync: true,
        deviceCategory: 'smartphone',
        petrockEnabled: true,
        petrockEnabledTiers: new Set(['attFinance']),
        tier: IMEI_SERVICE_TIERS.attFinance,
        tierKey: 'attFinance',
      })
    ).toBeNull();
  });
});

it('retains supported allowlisted Petrock routing with the exact input field', () => {
  expect(
    resolveImeiProviderBinding({
      clientSupportsAsync: true,
      deviceCategory: 'smartphone',
      petrockEnabled: true,
      petrockEnabledTiers: new Set(['simLock']),
      tier: IMEI_SERVICE_TIERS.simLock,
      tierKey: 'simLock',
    })
  ).toMatchObject({
    provider: 'petrock',
    productId: '716',
    orderFieldName: 'IMEI',
  });
});
it('fails closed when rejected blacklist has no alternate provider', () => {
  expect(
    resolveImeiProviderBinding({
      clientSupportsAsync: true,
      deviceCategory: 'smartphone',
      petrockEnabled: true,
      petrockEnabledTiers: new Set(['blacklist']),
      tier: {
        ...IMEI_SERVICE_TIERS.blacklist,
        providerServiceId: 'petrock-only',
      },
      tierKey: 'blacklist',
    })
  ).toBeNull();
});
