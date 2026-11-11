/**
 * Maps the RAISE codes emitted by the Credit-Direct capability-token RPCs
 * (`issue_credit_direct_checkout_token` and the token-consuming
 * `set_credit_direct_session`) to stable HTTP responses for the guest sign
 * route. Kept as a pure module so the mapping is unit-testable independently of
 * the route and the Supabase client.
 */

export interface CreditDirectRpcErrorMapping {
  status: number;
  body: { error: string; code?: string };
}

// Insertion order is match order; no code is a substring of another, so the
// first `includes` hit is unambiguous even when Postgres prefixes the message.
const KNOWN_RPC_ERRORS: Record<string, CreditDirectRpcErrorMapping> = {
  credit_direct_wallet_attempt_pending: {
    status: 409,
    body: {
      error:
        'This Credit Direct application is still pending. Check your order or contact support before starting another payment.',
      code: 'CREDIT_DIRECT_WALLET_PENDING',
    },
  },
  credit_direct_wallet_shipping_unsupported: {
    status: 409,
    body: {
      error:
        'Credit Direct cannot combine wallet credit with this delivery charge. Your wallet credit remains on the order; contact support to continue.',
      code: 'CREDIT_DIRECT_WALLET_SHIPPING_UNSUPPORTED',
    },
  },
  credit_direct_wallet_origin_unverified: {
    status: 409,
    body: {
      error:
        'This order needs payment review before Credit Direct can use wallet credit. Check your order or contact support.',
      code: 'CREDIT_DIRECT_WALLET_REVIEW_REQUIRED',
    },
  },
  credit_direct_wallet_reconciliation_required: {
    status: 409,
    body: {
      error:
        'Your wallet payment needs review before Credit Direct can continue. Check your order or contact support.',
      code: 'CREDIT_DIRECT_WALLET_REVIEW_REQUIRED',
    },
  },
  credit_direct_wallet_retry_required: {
    status: 503,
    body: {
      error:
        'Your wallet payment is being updated. Please retry this saved order shortly.',
      code: 'CREDIT_DIRECT_WALLET_RETRY_REQUIRED',
    },
  },
  order_not_found: {
    status: 404,
    body: { error: 'Order not found or email mismatch' },
  },
  credit_direct_disabled: {
    status: 403,
    body: { error: 'Credit Direct BNPL is not enabled for this merchant' },
  },
  order_not_payable: {
    status: 409,
    body: {
      error: 'This order can no longer be paid',
      code: 'ORDER_NOT_PAYABLE',
    },
  },
  order_amount_changed: {
    status: 409,
    body: {
      error: 'The order total changed, please restart checkout',
      code: 'ORDER_AMOUNT_CHANGED',
    },
  },
  invalid_order_amount: {
    status: 400,
    body: { error: 'Invalid order total' },
  },
  amount_out_of_range: {
    status: 400,
    body: { error: 'Amount is not eligible for Credit Direct BNPL' },
  },
  invalid_session: {
    status: 400,
    body: { error: 'Invalid checkout session' },
  },
  invalid_checkout_token: {
    status: 409,
    body: {
      error: 'Credit Direct checkout session is no longer valid, please retry',
      code: 'CHECKOUT_TOKEN_INVALID',
    },
  },
  checkout_token_mismatch: {
    status: 409,
    body: {
      error: 'Credit Direct checkout session is no longer valid, please retry',
      code: 'CHECKOUT_TOKEN_INVALID',
    },
  },
  checkout_token_expired: {
    status: 409,
    body: {
      error: 'Credit Direct checkout session expired, please retry',
      code: 'CHECKOUT_TOKEN_EXPIRED',
    },
  },
  checkout_token_already_used: {
    status: 409,
    body: {
      error: 'Credit Direct checkout session was already used, please retry',
      code: 'CHECKOUT_TOKEN_USED',
    },
  },
};

export const CREDIT_DIRECT_RPC_ERROR_FALLBACK: CreditDirectRpcErrorMapping = {
  status: 500,
  body: { error: 'Failed to initialize Credit Direct checkout' },
};

/**
 * Resolve a Supabase RPC error message to an HTTP response mapping. Unknown
 * messages fall back to an opaque 500 so internal detail never reaches the
 * client.
 */
export function resolveCreditDirectRpcError(
  message: string | null | undefined,
  fallback: CreditDirectRpcErrorMapping = CREDIT_DIRECT_RPC_ERROR_FALLBACK
): CreditDirectRpcErrorMapping {
  if (typeof message === 'string' && message.length > 0) {
    for (const [code, mapping] of Object.entries(KNOWN_RPC_ERRORS)) {
      if (message.includes(code)) {
        return mapping;
      }
    }
  }
  return fallback;
}
