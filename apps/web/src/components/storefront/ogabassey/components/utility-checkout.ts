export interface UtilityCheckoutPayload {
  amount: number;
  billerName?: string;
  billItemIdentifier?: string;
  billerCode?: string;
  customerAddress?: string;
  customerIdentifier?: string;
  dataPlanCode?: string;
  networkProvider?: string;
  phoneNumber?: string;
  productCode?: string;
  provider?: 'kuda' | 'monnify';
  requireValidationRef?: boolean;
  type: string;
  validationReference?: string;
}

export interface UtilityCheckoutCashback {
  amount: number;
  newBalance: number;
}

export interface UtilityCheckoutResponse {
  amount?: number;
  authorization_url?: string;
  /**
   * Deliberately unvalidated here: read it only through
   * `parseUtilityCheckoutCashback` so a malformed block degrades to the
   * balance-decrement fallback instead of failing the checkout.
   */
  cashback?: unknown;
  checkout_url?: string;
  error?: string;
  reference?: string;
  status?: string;
}

/**
 * Lenient cashback guard: a malformed cashback block must never fail the
 * whole checkout — callers fall back to decrementing the local balance.
 */
export function parseUtilityCheckoutCashback(
  data: unknown
): UtilityCheckoutCashback | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const cashback = data as Record<string, unknown>;
  if (
    typeof cashback.amount !== 'number' ||
    typeof cashback.newBalance !== 'number'
  ) {
    return undefined;
  }
  return { amount: cashback.amount, newBalance: cashback.newBalance };
}

export function isUtilityCheckoutResponse(
  data: unknown
): data is UtilityCheckoutResponse {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }

  const response = data as Record<string, unknown>;
  return (
    (response.amount === undefined || typeof response.amount === 'number') &&
    (response.authorization_url === undefined ||
      typeof response.authorization_url === 'string') &&
    (response.checkout_url === undefined ||
      typeof response.checkout_url === 'string') &&
    (response.error === undefined || typeof response.error === 'string') &&
    (response.reference === undefined ||
      typeof response.reference === 'string') &&
    (response.status === undefined || typeof response.status === 'string')
  );
}

export function getCheckoutErrorMessage(data: unknown) {
  return isUtilityCheckoutResponse(data) && data.error
    ? data.error
    : 'Transaction failed';
}

export function createWalletIdempotencyKey() {
  return crypto.randomUUID();
}
