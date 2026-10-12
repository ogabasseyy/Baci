export interface CartToolOutput {
  success: boolean;
  cart_token?: string;
  cart_url?: string;
  cart_expired?: true;
  quota_exceeded?: true;
  retry_after_seconds?: number;
  requires_variant_selection?: true;
  product_unavailable?: true;
  cart_full?: true;
}

const CART_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extracts the structured payload from a raw tool result, if present. */
export function readStructuredContent(response: unknown): unknown {
  return typeof response === 'object' && response !== null
    ? Reflect.get(response, 'structuredContent')
    : undefined;
}

/**
 * Validates guest-cart tool output without zod: the served widget must stay
 * dependency-free. A success response is accepted only with the handoff
 * fields the widget actually uses.
 */
export function parseCartToolOutput(value: unknown): CartToolOutput | undefined {
  if (!isRecord(value) || typeof value.success !== 'boolean') return undefined;
  if (value.success === false) {
    const failure: CartToolOutput = { success: false };
    if (value.cart_expired === true) failure.cart_expired = true;
    if (value.quota_exceeded === true) failure.quota_exceeded = true;
    if (
      typeof value.retry_after_seconds === 'number' &&
      Number.isFinite(value.retry_after_seconds) &&
      value.retry_after_seconds >= 0
    )
      failure.retry_after_seconds = Math.floor(value.retry_after_seconds);
    if (value.requires_variant_selection === true)
      failure.requires_variant_selection = true;
    if (value.product_unavailable === true) failure.product_unavailable = true;
    if (value.cart_full === true) failure.cart_full = true;
    return failure;
  }
  const { cart_token, cart_url } = value;
  if (typeof cart_token !== 'string' || !CART_TOKEN_PATTERN.test(cart_token))
    return undefined;
  if (typeof cart_url !== 'string') return undefined;
  return { success: true, cart_token, cart_url };
}
