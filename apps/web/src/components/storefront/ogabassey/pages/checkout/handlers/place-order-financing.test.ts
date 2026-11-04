import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
import { routePlaceOrderFinancing } from './place-order-financing';
afterEach(() => vi.unstubAllEnvs());
it('treats an unavailable CredPal key as handled and never clears the cart or navigates', async () => {
  vi.stubEnv('NEXT_PUBLIC_CREDPAL_KEY', '');
  const clearCart = vi.fn();
  const routerPush = vi.fn();
  const setIsProcessing = vi.fn();
  const inFlight = { current: true };
  const handled = await routePlaceOrderFinancing(
    {
      paymentMethod: 'credpal',
      cart: [],
      clearCart,
      routerPush,
      setIsProcessing,
      isOrderInFlightRef: inFlight,
    } as never,
    { id: 'merchant', slug: 'shop' },
    { id: 'order' },
    100,
    '',
    []
  );
  expect(handled).toBe(true);
  expect(clearCart).not.toHaveBeenCalled();
  expect(routerPush).not.toHaveBeenCalled();
  expect(setIsProcessing).toHaveBeenCalledWith(false);
  expect(inFlight.current).toBe(false);
});
