/** Kuda price-list fixtures shared by the bill price recheck suites. */
export const startimesSuper = {
  amount: 9500,
  isAmountFixed: true,
  itemCode: 'KUD-CAB-STT-SUPER',
  itemCurrencySymbol: 'NGN',
  itemFee: 0,
  itemName: 'DTT SUPER MONTHLY 9500NGN',
};

export function startimes(overrides: Record<string, unknown> = {}) {
  return {
    billerId: 'startimes',
    billerName: 'STARTIMES NG',
    billerType: 'Cable',
    categoryId: 'cable',
    categoryName: 'CableTv',
    billItems: [
      {
        ...startimesSuper,
        amount: 0,
        isAmountFixed: false,
        itemCode: 'group',
        itemName: 'Group',
        billItems: [startimesSuper],
      },
    ],
    ...overrides,
  };
}

export const superPackage = {
  amount: 9500,
  billItemIdentifier: 'KUD-CAB-STT-SUPER',
  type: 'cable_tv',
};
