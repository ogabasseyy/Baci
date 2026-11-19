import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateApiRequest,
  NextRequest,
  POST,
} from './route.order-test-mocks.test-support';
import {
  baseOrderPayload,
  buildPilotMockSupabase,
  CUSTOMER_ID,
  primeAdminOrderCurrencyRead,
} from './route.redvault-pilot-fixtures.test-support';

// Full wallet-coverage finalization cases, split from oversized route.test.ts.
type RpcOutcome = { data: unknown; error: unknown };

const WALLET_TRANSACTION_ID = '88888888-aaaa-bbbb-cccc-eeeeeeeeeeee';

const RPC_DEFAULTS: Record<string, RpcOutcome> = {
  create_storefront_order: {
    data: [
      {
        id: 'order-id',
        order_number: 'ORD-123',
        total: 1000,
        subtotal: 1000,
        shipping_fee: 0,
        customer_id: CUSTOMER_ID,
        tracking_token: 'track-default-1',
      },
    ],
    error: null,
  },
  redeem_wallet_for_order: {
    data: [
      {
        success: true,
        redeemed_amount: 1000,
        new_balance: 0,
        transaction_id: WALLET_TRANSACTION_ID,
      },
    ],
    error: null,
  },
  has_storefront_order_idempotency_key: { data: false, error: null },
  get_order_variant_overrides: { data: [], error: null },
  get_checkout_shipping_quote: { data: null, error: null },
  persist_storefront_order_delivery_metadata: { data: false, error: null },
  claim_immediate_order_notification_with_proof: {
    data: [{ claimed: true, claim_status: 'processing', claim_token: 't' }],
    error: null,
  },
  complete_immediate_order_notification_with_proof: {
    data: null,
    error: null,
  },
  mark_immediate_order_notification_started_with_proof: {
    data: true,
    error: null,
  },
};

// Wallet redemption covers the whole 1000 order; the finalize RPC answers
// with `finalize` so each case controls whether it succeeds or refuses.
async function primeWalletCheckout(finalize: RpcOutcome) {
  const finalizeSpy = vi.fn((_params?: unknown) => Promise.resolve(finalize));
  const supabase = {
    ...buildPilotMockSupabase({ productRows: [{ id: 'p-1', price: 1000 }] }),
    rpc: vi.fn(
      async (name: string, params?: unknown): Promise<RpcOutcome> =>
        name === 'finalize_wallet_order_payment'
          ? finalizeSpy(params)
          : (RPC_DEFAULTS[name] ?? { data: null, error: null })
    ),
  };
  const supabaseMod = await import('@/lib/supabase/server');
  vi.mocked(supabaseMod.createClient).mockImplementation(
    () => supabase as unknown as never
  );
  return finalizeSpy;
}

function walletOrderRequest() {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      ...baseOrderPayload,
      use_wallet_credit: true,
      wallet_amount: 1000,
    }),
  });
}

describe('POST /api/orders — full wallet coverage finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  it('full-coverage wallet redemption returns amountDueToGateway=0 and finalizes payment', async () => {
    // Pin the full-coverage path that the mobile client uses to skip the
    // gateway initialize step entirely. Order is marked paid via
    // finalize_wallet_order_payment.
    const finalizeSpy = await primeWalletCheckout({ data: null, error: null });

    const response = await POST(walletOrderRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.wallet).toEqual({
      amountUsed: 1000,
      newBalance: 0,
      transactionId: WALLET_TRANSACTION_ID,
    });
    expect(body.amountDueToGateway).toBe(0);
    expect(body.order.payment_status).toBe('paid');
    expect(body.order.payment_method).toBe('wallet');
    expect(finalizeSpy).toHaveBeenCalledTimes(1);
    expect(finalizeSpy).toHaveBeenCalledWith({
      p_amount: 1000,
      p_order_id: 'order-id',
    });
  });

  it('logs and never reports the order paid when the finalize RPC refuses', async () => {
    // finalize_wallet_order_payment verifies the wallet debit server-side and
    // can refuse. The route must log it and leave walletFinalized false, so
    // the response never claims the order was paid by wallet.
    const finalizeSpy = await primeWalletCheckout({
      data: null,
      error: { code: 'P0001', message: 'wallet_debit_insufficient' },
    });

    const response = await POST(walletOrderRequest());
    const body = await response.json();

    // The HTTP status is deliberately not pinned: only the "never report the
    // order paid, and log" contract is.
    expect(finalizeSpy).toHaveBeenCalledWith({
      p_amount: 1000,
      p_order_id: 'order-id',
    });
    expect(body.order?.payment_status).not.toBe('paid');
    expect(body.order?.payment_method).not.toBe('wallet');
    const { logger } = await import('@/lib/logger');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to finalize wallet payment',
        orderId: 'order-id',
      })
    );
  });
});
