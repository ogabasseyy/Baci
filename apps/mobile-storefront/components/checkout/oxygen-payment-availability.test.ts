import { getOxygenMobileProfile } from '@/lib/oxygen-mobile-profile';
import { isBnplPayment } from './is-bnpl-payment';
import { usePaymentMethodAvailability } from './payment-method-selector/usePaymentMethodAvailability';

jest.mock('@/lib/oxygen-mobile-profile', () => ({
  getOxygenMobileProfile: jest.fn(),
}));
jest.mock('@/stores/cart-store', () => ({
  formatPrice: (amount: number) => String(amount),
}));
describe('isolated Oxygen payment selector', () => {
  const input = {
    enabledMethods: ['oxygen' as const],
    methodDisabledReasons: {},
    orderTotal: 50000,
    selectedMethod: null,
    selectedTab: 'installments' as const,
  };
  it('hides Oxygen even if merchant settings name it outside the staging profile', () => {
    jest.mocked(getOxygenMobileProfile).mockReturnValue(null);
    expect(
      usePaymentMethodAvailability(input).availableMethodIds
    ).not.toContain('oxygen');
  });
  it('shows the native staging path and keeps it out of the generic BNPL initializer', () => {
    jest
      .mocked(getOxygenMobileProfile)
      .mockReturnValue({} as ReturnType<typeof getOxygenMobileProfile>);
    expect(usePaymentMethodAvailability(input).availableMethodIds).toContain(
      'oxygen'
    );
    expect(isBnplPayment('oxygen')).toBe(false);
  });
  it.each([
    { walletSelection: { use: true, amount: 10 } },
    { savingsSelection: { use: true, amount: 10, goalId: 'goal' } },
  ])('lets customers choose Oxygen and switch away from full-payment credit', (selection) => {
    jest
      .mocked(getOxygenMobileProfile)
      .mockReturnValue({} as ReturnType<typeof getOxygenMobileProfile>);
    const result = usePaymentMethodAvailability({ ...input, ...selection });
    expect(result.filteredMethods[0].disabled).not.toBe(true);
  });
});
