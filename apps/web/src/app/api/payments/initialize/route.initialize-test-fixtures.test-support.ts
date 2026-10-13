import { NextRequest } from 'next/server';
import { vi } from 'vitest';
// Cycle with the mocks module is safe: both sides only touch the shared
// bindings inside functions that run at test time, never at evaluation.
import { routeMocks } from './route.initialize-test-mocks.test-support';

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const ORDER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

let rpcResult: { data: unknown; error: unknown };
let rpcTransactionResult: { data: unknown; error: unknown };
let rpcDvaReservationResult: { data: unknown; error: unknown };
let redvaultAttemptInitializeResult: { data: unknown; error: unknown };
let redvaultAttemptClaimResults: Array<{ data: unknown; error: unknown }>;
let redvaultAttemptReserveResults: Array<{ data: unknown; error: unknown }>;
let rpcTokenProofResult: { data: unknown; error: unknown };
const rpcCalls: Array<{ args?: unknown; name: string }> = [];

function createMockSupabase() {
  return {
    rpc: vi.fn((name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'get_order_payment_snapshot')
        return Promise.resolve(rpcResult);
      if (name === 'verify_order_tracking_token')
        return Promise.resolve(rpcTokenProofResult);
      if (name === 'get_storefront_redvault_paystack_subaccount')
        return Promise.resolve({
          data:
            merchantResult.data && typeof merchantResult.data === 'object'
              ? (merchantResult.data as { paystack_subaccount_code?: unknown })
                  .paystack_subaccount_code
              : null,
          error: null,
        });
      if (name === 'create_payment_transaction')
        return Promise.resolve(rpcTransactionResult);
      if (name === 'reserve_paystack_order_payment_account')
        return Promise.resolve(rpcDvaReservationResult);
      if (name === 'reserve_storefront_redvault_payment_attempt_v3')
        return Promise.resolve(redvaultAttemptReserveResults.shift());
      if (
        name === 'claim_storefront_redvault_payment_attempt_initialization_v3'
      )
        return Promise.resolve(redvaultAttemptClaimResults.shift());
      if (
        name === 'record_storefront_redvault_payment_attempt_initialization_v2'
      )
        return Promise.resolve(redvaultAttemptInitializeResult);
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

let merchantResult: { data: unknown; error: unknown };
let featureSettingsResult: { data: unknown; error: unknown };
let orderPaymentResult: { data: unknown; error: unknown };
let orderTokenResult: { data: unknown; error: unknown };
let savingsRedemptionsResult: { data: unknown; error: unknown };

function createMockAdminClient() {
  return {
    from: (table: string) => {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(merchantResult),
            }),
          }),
        };
      }
      if (table === 'merchant_feature_settings') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(featureSettingsResult),
            }),
          }),
        };
      }
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve(orderPaymentResult),
              }),
              single: () => Promise.resolve(orderTokenResult),
            }),
          }),
        };
      }
      if (table === 'customer_savings_redemptions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve(savingsRedemptionsResult),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  };
}

// Admin client is used for all Supabase operations (mobile Bearer-token compat).
// The mock returns separate sub-clients so RPC calls (snapshot, transaction)
// and table queries (merchants, feature_settings) can be controlled independently.
const validBody = {
  merchant_id: MERCHANT_ID,
  order_id: ORDER_ID,
  amount: 5000,
  currency: 'NGN',
  customer_email: 'customer@example.com',
  customer_name: 'John Doe',
  customer_phone: '08012345678',
  billing_address: {
    line1: '123 Main St',
    city: 'Lagos',
    country: 'NG',
    zip_code: '100001',
  },
};

function makeRequest(
  body: Record<string, unknown>,
  init?: { headers?: Record<string, string>; url?: string }
) {
  return new NextRequest(
    init?.url || 'http://localhost:3000/api/payments/initialize',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      body: JSON.stringify(body),
    }
  );
}

function setupDefaults() {
  rpcResult = {
    data: [
      {
        merchant_id: MERCHANT_ID,
        total: 5000,
        tracking_token: 'track-token-123',
      },
    ],
    error: null,
  };
  rpcTransactionResult = { data: null, error: null };
  rpcDvaReservationResult = { data: 'inserted', error: null };
  redvaultAttemptInitializeResult = { data: null, error: null };
  redvaultAttemptClaimResults = [];
  redvaultAttemptReserveResults = [];
  rpcTokenProofResult = { data: true, error: null };
  merchantResult = {
    data: {
      id: MERCHANT_ID,
      business_name: 'Test Store',
      slug: 'test-store',
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
    },
    error: null,
  };
  featureSettingsResult = { data: null, error: null };
  orderPaymentResult = { data: { wallet_amount_used: 0 }, error: null };
  orderTokenResult = {
    data: { tracking_token: 'track-token-123' },
    error: null,
  };
  savingsRedemptionsResult = { data: [], error: null };
  routeMocks.authenticateApiRequest.mockResolvedValue({ user: null });
  routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
    available: false,
    reason: 'provider_evidence_unavailable',
  });
  rpcCalls.length = 0;
}

// Split suites assign through setters: imported `let` bindings are
// read-only in the importing module.
export function setRpcResult(value: { data: unknown; error: unknown }) {
  rpcResult = value;
}

export function setSavingsRedemptionsResult(value: {
  data: unknown;
  error: unknown;
}) {
  savingsRedemptionsResult = value;
}

export function setMerchantResult(value: { data: unknown; error: unknown }) {
  merchantResult = value;
}

export {
  createMockAdminClient,
  createMockSupabase,
  MERCHANT_ID,
  makeRequest,
  ORDER_ID,
  rpcCalls,
  setupDefaults,
  validBody,
};
