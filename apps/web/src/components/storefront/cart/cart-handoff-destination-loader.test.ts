import { expect, it, vi } from 'vitest';
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
