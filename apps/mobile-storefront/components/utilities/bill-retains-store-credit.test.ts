import type { Biller } from '@/hooks/use-vtu-billers';
import type { PaymentState } from './bill-form-purchase.types';
import { billRetainsStoreCredit } from './bill-retains-store-credit';

const biller = {
  billerId: 'ikedc',
  billerName: 'Ikeja Electric',
} as unknown as Biller;

function input(hasRetainedVtuAttempt: jest.Mock, overrides = {}) {
  return {
    billType: 'electricity' as const,
    customer: { first_name: 'Ada', last_name: 'Obi', phone: '0803' },
    customerId: '45012345678',
    numericAmount: 5000,
    payment: { hasRetainedVtuAttempt } as unknown as PaymentState,
    selectedBiller: biller,
    selectedBillItem: null,
    selectedBillItemIdentifier: null,
    selectedBillItemPathLabel: '',
    verifiedCustomerName: 'ADA OBI',
    verifiedCustomerAddress: null,
    ...overrides,
  };
}

describe('billRetainsStoreCredit', () => {
  it('reports a retained attempt for the exact request the submit builds', () => {
    const peek = jest.fn().mockReturnValue(true);
    expect(billRetainsStoreCredit(input(peek))).toBe(true);
    expect(peek).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        billerName: 'Ikeja Electric',
        customerIdentifier: '45012345678',
        customerName: 'ADA OBI',
        type: 'electricity',
        walletAmount: 5000,
      })
    );
  });

  it('is false when nothing is retained', () => {
    expect(
      billRetainsStoreCredit(input(jest.fn().mockReturnValue(false)))
    ).toBe(false);
  });

  it('never peeks without a provider or an amount', () => {
    const peek = jest.fn().mockReturnValue(true);
    expect(billRetainsStoreCredit(input(peek, { selectedBiller: null }))).toBe(
      false
    );
    expect(billRetainsStoreCredit(input(peek, { numericAmount: 0 }))).toBe(
      false
    );
    expect(peek).not.toHaveBeenCalled();
  });
});
