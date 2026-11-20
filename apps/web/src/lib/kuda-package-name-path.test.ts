import { describe, expect, it } from 'vitest';
import type { BillItem } from './kuda-bill-items';
import { isPackageNamePath } from './kuda-package-name-path';

const item = (itemCode: string, itemName: string, billItems?: BillItem[]) => ({
  amount: 9500,
  isAmountFixed: true,
  itemCode,
  itemCurrencySymbol: 'NGN',
  itemFee: 0,
  itemName,
  ...(billItems && { billItems }),
});

const items: BillItem[] = [
  item('A', 'DStv Compact'),
  item('GROUP', 'Premium', [item('B', 'Monthly')]),
];

describe('isPackageNamePath', () => {
  it('accepts a flat package name, ignoring case and spacing', () => {
    expect(isPackageNamePath(items, 'a', 'dstv  compact')).toBe(true);
  });

  it('accepts a nested path joined by " / "', () => {
    expect(isPackageNamePath(items, 'b', 'premium / monthly')).toBe(true);
  });

  it('rejects a path to a different package', () => {
    expect(isPackageNamePath(items, 'a', 'premium / monthly')).toBe(false);
  });

  it('rejects a path that is not this biller’s', () => {
    expect(isPackageNamePath(items, 'b', 'premium - monthly')).toBe(false);
    expect(isPackageNamePath(undefined, 'b', 'monthly')).toBe(false);
  });
});
