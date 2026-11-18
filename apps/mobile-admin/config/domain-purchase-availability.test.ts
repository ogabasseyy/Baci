// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isDomainPurchaseEnabled } from './domain-purchase-availability';

describe('isDomainPurchaseEnabled', () => {
  it('disables domain purchasing on Android', () => {
    expect(isDomainPurchaseEnabled('android')).toBe(false);
  });

  it('keeps domain purchasing enabled on iOS and web', () => {
    expect(isDomainPurchaseEnabled('ios')).toBe(true);
    expect(isDomainPurchaseEnabled('web')).toBe(true);
    expect(isDomainPurchaseEnabled()).toBe(true);
  });
});
