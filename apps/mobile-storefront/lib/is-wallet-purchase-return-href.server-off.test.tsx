import { describe, expect, it } from '@jest/globals';
import { isWalletPurchaseReturnHref } from './is-wallet-purchase-return-href';

// Pure routing check: no server call, so it behaves the same with PiggyVest off.
describe('isWalletPurchaseReturnHref', () => {
  it('recognises IMEI and utility purchase returns', () => {
    expect(isWalletPurchaseReturnHref('/imei-check')).toBe(true);
    expect(
      isWalletPurchaseReturnHref('/utilities/airtime?repeatAmount=500')
    ).toBe(true);
  });

  it('treats savings and wallet returns as savings, not purchases', () => {
    expect(isWalletPurchaseReturnHref('/wallet/savings/start')).toBe(false);
    expect(isWalletPurchaseReturnHref('/wallet?action=savings')).toBe(false);
    expect(isWalletPurchaseReturnHref('/wallet')).toBe(false);
    expect(isWalletPurchaseReturnHref(undefined)).toBe(false);
  });

  it('rejects look-alike and unsafe paths', () => {
    expect(isWalletPurchaseReturnHref('/imei-checkout')).toBe(false);
    expect(isWalletPurchaseReturnHref('https://evil.test/imei-check')).toBe(
      false
    );
  });
});
