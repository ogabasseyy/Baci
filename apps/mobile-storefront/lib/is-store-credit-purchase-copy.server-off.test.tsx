import { describe, expect, it } from '@jest/globals';
import { isStoreCreditPurchaseCopy } from './is-store-credit-purchase-copy';

describe('isStoreCreditPurchaseCopy', () => {
  it('is store credit once the PiggyVest wallet is ready', () => {
    expect(isStoreCreditPurchaseCopy({ primary_balance_kobo: 0 })).toBe(true);
  });

  it('bugfix: is store credit while a confirmed PiggyVest balance is pending', () => {
    expect(isStoreCreditPurchaseCopy({ primary_pending: true })).toBe(true);
  });

  it('keeps the wallet wording where the server keeps PiggyVest off', () => {
    expect(isStoreCreditPurchaseCopy({})).toBe(false);
    expect(isStoreCreditPurchaseCopy({ primary_unavailable: true })).toBe(
      false
    );
    expect(isStoreCreditPurchaseCopy(undefined)).toBe(false);
  });
});
