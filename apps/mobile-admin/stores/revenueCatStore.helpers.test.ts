// @vitest-environment jsdom

import type { CustomerInfo } from 'react-native-purchases';
import { describe, expect, it } from 'vitest';
import { isProFromInfo } from './revenueCatStore.helpers';

function createCustomerInfo(active: Record<string, unknown>): CustomerInfo {
  return {
    entitlements: { active },
  } as CustomerInfo;
}

describe('isProFromInfo', () => {
  it('recognizes supported pro entitlement aliases case-insensitively', () => {
    expect(isProFromInfo(createCustomerInfo({ BACI_PRO: {} }))).toBe(true);
    expect(isProFromInfo(createCustomerInfo({ yearly: {} }))).toBe(true);
  });

  it('returns false for missing or unrelated entitlements', () => {
    expect(isProFromInfo(null)).toBe(false);
    expect(isProFromInfo(createCustomerInfo({ free: {} }))).toBe(false);
  });
});
