export interface CartToolOutput {
  success: boolean;
  cart_token?: string;
  cart_url?: string;
  cart_expired?: true;
}

const CART_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates guest-cart tool output without zod: the served widget must stay
 * dependency-free. A success response is accepted only with the handoff
 * fields the widget actually uses.
 */
export function parseCartToolOutput(value: unknown): CartToolOutput | undefined {
  if (!isRecord(value) || typeof value.success !== 'boolean') return undefined;
  if (value.success === false)
    return value.cart_expired === true
      ? { success: false, cart_expired: true as const }
      : { success: false };
  const { cart_token, cart_url } = value;
  if (typeof cart_token !== 'string' || !CART_TOKEN_PATTERN.test(cart_token))
    return undefined;
  if (typeof cart_url !== 'string') return undefined;
  return { success: true, cart_token, cart_url };
}
