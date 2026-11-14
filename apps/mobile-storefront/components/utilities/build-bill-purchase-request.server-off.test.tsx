import { buildBillPurchaseRequest } from './build-bill-purchase-request';

jest.mock('./resolve-bill-fulfillment', () => ({
  resolveBillFulfillment: () => ({
    provider: 'monnify',
    billerCode: 'IKEDC',
    productCode: 'PREPAID',
  }),
}));

const base = {
  amount: 5000,
  billItem: {} as never,
  biller: { billerName: 'Ikeja Electric' } as never,
  billItemIdentifier: 'item-1',
  billItemPathLabel: 'Prepaid',
  customerIdentifier: '45031234567',
  customerName: 'Ada',
  customerPhone: '08031234567',
  type: 'electricity' as const,
};

describe('buildBillPurchaseRequest', () => {
  it('builds the wallet-only bill purchase with the fulfillment routing', () => {
    expect(buildBillPurchaseRequest(base)).toEqual({
      amount: 5000,
      billItemIdentifier: 'item-1',
      billerCode: 'IKEDC',
      billerName: 'Ikeja Electric - Prepaid',
      customerIdentifier: '45031234567',
      customerName: 'Ada',
      customerPhone: '08031234567',
      productCode: 'PREPAID',
      provider: 'monnify',
      type: 'electricity',
      walletAmount: 5000,
    });
  });

  it('adds the address and validation context only when present', () => {
    const request = buildBillPurchaseRequest({
      ...base,
      billItemPathLabel: null,
      customerAddress: '1 Allen Avenue',
      requireValidationRef: true,
      validationReference: 'VAL-1',
      customerPhone: null,
    });
    expect(request).toMatchObject({
      billerName: 'Ikeja Electric',
      customerAddress: '1 Allen Avenue',
      requireValidationRef: true,
      validationReference: 'VAL-1',
    });
    expect(request.customerPhone).toBeUndefined();
  });
});
