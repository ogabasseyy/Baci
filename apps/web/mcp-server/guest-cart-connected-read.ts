import type { GuestCanonicalBridge } from './guest-cart-canonical-bridge';
import { GuestCartStorageUnavailableError } from './guest-cart-errors';

/** Connected reads require a valid server capability and the canonical bridge. */
export async function readConnectedCart(bridge: GuestCanonicalBridge | null | undefined, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || !bridge?.read)
    throw new GuestCartStorageUnavailableError('Connected cart unavailable');
  return bridge.read(token);
}
