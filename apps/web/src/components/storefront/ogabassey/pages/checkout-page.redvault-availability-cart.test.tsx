import { vi } from 'vitest';
import { useCheckoutRedvaultAvailability } from './checkout/hooks/use-checkout-redvault-availability';
import {
  act,
  CheckoutPage,
  expect,
  hasPriceNegotiationEntitlement,
  it,
  mockCheckoutSubmissionState,
  render,
  useCart,
} from './checkout-page-test-support';

vi.mock('./checkout/hooks/use-checkout-redvault-availability', () => ({
  useCheckoutRedvaultAvailability: vi.fn(() => ({
    availability: { available: false, reason: 'unavailable' },
    waitForResolvedAuthenticated: vi.fn(),
  })),
}));

it('passes the sanitized checkout cart to the REDVAULT availability hook', async () => {
  vi.mocked(hasPriceNegotiationEntitlement).mockReturnValue(false);
  mockCheckoutSubmissionState();
  const mockCart = [
    {
      id: 'item-1',
      cartItemId: 'ci-1',
      name: 'Test Product',
      price: 5000,
      negotiatedPrice: 4000,
      negotiationStatus: 'accepted' as const,
      quantity: 1,
      image: '',
      slug: 'test-product',
    },
  ];
  vi.mocked(useCart).mockReturnValue({
    cart: mockCart,
    cartTotal: 5000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => {
      return {
        ok: true,
        json: async () => ({ states: ['Lagos'], locations: [] }),
        text: async () => '',
      } as Response;
    });

  try {
    render(<CheckoutPage />);
    await act(async () => {});

    const hook = vi.mocked(useCheckoutRedvaultAvailability);
    expect(hook).toHaveBeenCalled();
    const cartItems = hook.mock.calls[0]?.[0]?.cartItems;
    expect(cartItems === (mockCart as unknown)).toBe(false);
    expect(
      (cartItems?.[0] as { negotiatedPrice?: unknown } | undefined)
        ?.negotiatedPrice
    ).toBeUndefined();
    expect(cartItems?.[0]).toEqual(
      expect.objectContaining({ id: 'item-1', quantity: 1 })
    );
  } finally {
    fetchMock.mockRestore();
  }
});
