import type { CartSnapshot } from '@baci/shared/cart';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchDestinationCart } from './cart-handoff-destination';
import { loadDestinationCart } from './cart-handoff-destination-loader';

vi.mock('./cart-handoff-destination', () => ({
  fetchDestinationCart: vi.fn(),
}));

function deps() {
  return {
    bootstrapRequired: { current: false },
    setDestCart: vi.fn(),
    setDestChecked: vi.fn(),
    setDestinationError: vi.fn(),
  };
}

it('publishes a checked destination cart', async () => {
  const cart = { cartId: 'dest' } as never;
  vi.mocked(fetchDestinationCart).mockResolvedValue({
    status: 'checked',
    cart,
    bootstrapRequired: true,
  });
  const d = deps();
  await loadDestinationCart(d, 'shop');
  expect(d.bootstrapRequired.current).toBe(true);
  expect(d.setDestCart).toHaveBeenCalledWith(cart);
  expect(d.setDestChecked).toHaveBeenLastCalledWith(true);
});

it('marks the destination checked on a load error', async () => {
  vi.mocked(fetchDestinationCart).mockResolvedValue({ status: 'error' });
  const d = deps();
  await loadDestinationCart(d, 'shop');
  expect(d.setDestChecked).toHaveBeenLastCalledWith(true);
  expect(d.setDestinationError).toHaveBeenCalledWith(
    'Could not check your existing cart. Please try again.'
  );
});

it('surfaces a retryable error when the bounded refresh deadline aborts', async () => {
  vi.mocked(fetchDestinationCart).mockResolvedValue({ status: 'error' });
  const controller = new AbortController();
  controller.abort();
  const d = deps();
  await loadDestinationCart(d, 'shop', controller.signal);
  expect(d.setDestChecked).toHaveBeenLastCalledWith(true);
  expect(d.setDestinationError).toHaveBeenCalledWith(
    'Could not check your existing cart. Please try again.'
  );
  expect(d.setDestCart).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllGlobals());

it('settles an already-owned cart before requesting the redirect', async () => {
  const cart = { cartId: 'same-cart', merchantId: 'merchant' } as CartSnapshot;
  vi.mocked(fetchDestinationCart).mockResolvedValue({
    status: 'checked',
    cart,
    bootstrapRequired: false,
  });
  const setDestChecked = vi.fn();
  const setDestCart = vi.fn();
  const replace = vi.fn(() => {
    expect(setDestChecked).toHaveBeenLastCalledWith(true);
    expect(setDestCart).toHaveBeenLastCalledWith(cart);
  });
  vi.stubGlobal('window', {
    location: { pathname: '/cart', search: '', replace },
  });
  await loadDestinationCart(
    {
      bootstrapRequired: { current: true },
      setDestCart,
      setDestChecked,
      setDestinationError: vi.fn(),
      incoming: { cart, handoffId: 'same-cart-link' },
    },
    'ogabassey'
  );
  expect(replace).toHaveBeenCalledExactlyOnceWith('/cart');
});
