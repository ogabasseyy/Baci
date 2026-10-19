import type { CartChangeEvent } from './types';

/** Treat broadcasts as untrusted routing hints, never as a cart snapshot. */
export function readCartChangeEvent(value: unknown): CartChangeEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.merchantId !== 'string' ||
    !event.merchantId ||
    typeof event.cartId !== 'string' ||
    !event.cartId ||
    typeof event.operationId !== 'string' ||
    !event.operationId ||
    event.operationId.length > 128 ||
    typeof event.version !== 'number' ||
    !Number.isSafeInteger(event.version) ||
    event.version < 1
  )
    return null;
  return {
    merchantId: event.merchantId,
    cartId: event.cartId,
    version: event.version,
    operationId: event.operationId,
  };
}

/** Duplicate and reordered hints cannot roll a confirmed snapshot backwards. */
export function shouldRefreshCart(
  currentVersion: number,
  event: CartChangeEvent,
  identity?: Pick<CartChangeEvent, 'merchantId' | 'cartId'>
): boolean {
  const parsed = readCartChangeEvent(event);
  return (
    parsed !== null &&
    Number.isSafeInteger(currentVersion) &&
    currentVersion >= 0 &&
    (!identity ||
      (parsed.merchantId === identity.merchantId &&
        parsed.cartId === identity.cartId)) &&
    parsed.version > currentVersion
  );
}
