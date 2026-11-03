import { describe, expect, it } from 'vitest';
import {
  createMerchantHookValue,
  defaultMerchant,
  setSmartNavUsage,
  smartNavStorageKey,
} from './client-layout.test-support';

describe('client layout test support', () => {
  it('builds an owner merchant hook value with permissions granted by default', () => {
    const value = createMerchantHookValue();

    expect(value.merchant).toBe(defaultMerchant);
    expect(value.staffAccess.isOwner).toBe(true);
    expect(value.hasPermission('integrations', 'view')).toBe(true);
  });

  it('applies overrides on top of the defaults', () => {
    const value = createMerchantHookValue({ loading: true });

    expect(value.loading).toBe(true);
    expect(value.basePath).toBe('/test-store');
  });

  it('stores smart-nav usage under the merchant-scoped key', () => {
    setSmartNavUsage({ products: 3 });

    expect(
      JSON.parse(localStorage.getItem(smartNavStorageKey) ?? 'null')
    ).toEqual({ products: 3 });
  });
});
