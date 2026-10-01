import type { OrderGiglMissingField } from './order-gigl-shipping';

export type OrderGiglQuoteFailure =
  | { kind: 'missing_address'; missing: OrderGiglMissingField[] }
  | { kind: 'error'; message: string };

export function resolveOrderGiglQuoteFailure(
  error: unknown
): OrderGiglQuoteFailure {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { code?: unknown; missing?: unknown };
    if (candidate.code === 'ORDER_SHIPPING_ADDRESS_INCOMPLETE') {
      return {
        kind: 'missing_address',
        missing: Array.isArray(candidate.missing) ? candidate.missing : [],
      };
    }
  }

  return {
    kind: 'error',
    message:
      error instanceof Error
        ? error.message
        : 'GIG shipping is temporarily unavailable.',
  };
}
