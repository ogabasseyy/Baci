import { expect, it, vi } from 'vitest';
import type { GuestCanonicalBridge } from './guest-cart-canonical-bridge';
import { readConnectedCart } from './guest-cart-connected-read';
it('rejects missing authority before delegating connected reads', async () => {
  const read = vi.fn(async () => ({ cart_token: 'a'.repeat(64), items: [], expires_at: 'later' }));
  const bridge = { read } as unknown as GuestCanonicalBridge;
  await expect(readConnectedCart(null, 'a'.repeat(64))).rejects.toThrow('Connected cart unavailable');
  await expect(readConnectedCart(bridge, 'invalid')).rejects.toThrow('Connected cart unavailable');
  expect(read).not.toHaveBeenCalled();
  await expect(readConnectedCart(bridge, 'a'.repeat(64))).resolves.toMatchObject({ items: [] });
  expect(read).toHaveBeenCalledWith('a'.repeat(64));
});
