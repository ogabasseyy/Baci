import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  getRedvaultPaymentAvailability: vi.fn(),
}));

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));
vi.mock('nanoid', () => ({ customAlphabet: () => () => 'ABCD12345678' }));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: routeMocks.authenticateApiRequest,
}));
vi.mock('@/lib/checkout/redvault-payment-availability', () => ({
  getRedvaultPaymentAvailability: routeMocks.getRedvaultPaymentAvailability,
  isRedvaultLivePilotReason: (reason: string) =>
    reason === 'private_live_pilot' || reason === 'public_product_test',
}));
vi.mock('@/lib/checkout/redvault-live-pilot', () => ({
  getRedvaultLivePilotPolicy: vi.fn(),
  REDVAULT_PILOT_USER_ID: '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
}));
vi.mock('@/lib/checkout/get-redvault-checkout-summary', () => ({
  getRedvaultCheckoutSummary: vi.fn(),
}));
vi.mock('@/lib/juicyway', () => ({
  initializePayment: vi.fn(),
  capturePaymentWithCrypto: vi.fn(),
  getPaymentSession: vi.fn(),
  getPayment: vi.fn(),
  extractCryptoAddress: vi.fn(),
  convertNgnKoboToUsdtCents: vi.fn(),
  formatPhoneToE164: (phone: string) =>
    `+234${phone.trim().replace(/^0/, '').replace(/\D/g, '')}`,
  generatePaymentReference: () => 'baci_test_ref123',
  getChainConfirmationTime: vi.fn(),
  isSupportedCurrency: (c: string) => c === 'NGN',
  JUICYWAY_CHAIN_SUPPORT: {},
}));
vi.mock('@/lib/korapay', () => ({
  initializePayment: vi.fn(),
  calculatePlatformFee: (amount: number) => ({
    platformFee: amount * 0.015,
    merchantAmount: amount * 0.985,
  }),
  SUPPORTED_CURRENCIES: ['NGN'],
}));

const mockInitializePaystack = vi.fn();
vi.mock('@/lib/paystack', () => ({
  initializeTransaction: (...args: unknown[]) =>
    mockInitializePaystack(...args),
  calculatePlatformFee: (amount: number) => ({
    platformFee: Math.round(amount * 0.015),
    merchantAmount: amount - Math.round(amount * 0.015),
  }),
}));

const mockCreateDedicatedVirtualAccount = vi.fn();
vi.mock('@/lib/agentic/paystack', () => ({
  createDedicatedVirtualAccount: (...args: unknown[]) =>
    mockCreateDedicatedVirtualAccount(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const ORDER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

let rpcRetainedShippingResult: { data: unknown; error: unknown };
let featureSettingsResult: { data: unknown; error: unknown };
const rpcCalls: Array<{ args?: unknown; name: string }> = [];
// RPC names issued through the request-scoped (non-admin) client.
const serverClientRpcNames: string[] = [];

const merchantRow = {
  id: MERCHANT_ID,
  business_name: 'Test Store',
  slug: 'test-store',
  paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
};

function createMockSupabase() {
  return {
    rpc: vi.fn((name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'get_order_payment_snapshot')
        return Promise.resolve({
          data: [
            {
              merchant_id: MERCHANT_ID,
              total: 5000,
              tracking_token: 'track-token-123',
            },
          ],
          error: null,
        });
      if (name === 'verify_order_tracking_token')
        return Promise.resolve({ data: true, error: null });
      if (name === 'get_storefront_redvault_paystack_subaccount')
        return Promise.resolve({
          data: merchantRow.paystack_subaccount_code,
          error: null,
        });
      if (name === 'get_order_paystack_split_retained_shipping_kobo')
        return Promise.resolve(rpcRetainedShippingResult);
      if (name === 'reserve_paystack_order_payment_account')
        return Promise.resolve({ data: 'inserted', error: null });
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

function createMockAdminClient() {
  const rows: Record<string, () => Promise<unknown>> = {
    merchants: () => Promise.resolve({ data: merchantRow, error: null }),
    merchant_feature_settings: () => Promise.resolve(featureSettingsResult),
    orders: () =>
      Promise.resolve({
        data: { wallet_amount_used: 0, tracking_token: 'track-token-123' },
        error: null,
      }),
  };
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: rows[table] ?? (() => Promise.resolve({ data: null })),
          }),
          single: rows[table] ?? (() => Promise.resolve({ data: null })),
        }),
      }),
    }),
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    ...createMockSupabase(),
    ...createMockAdminClient(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    const client = { ...createMockSupabase(), ...createMockAdminClient() };
    const rpc = client.rpc;
    return {
      ...client,
      rpc: (name: string, args?: unknown) => {
        serverClientRpcNames.push(name);
        return rpc(name, args);
      },
    };
  },
}));

// Dynamic import AFTER the mocks register.
const { POST } = await import('./route');

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

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/payments/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function enableDvaForTest() {
  featureSettingsResult = {
    data: { wallet_paystack_dva_enabled: true },
    error: null,
  };
}

function setRetainedShippingResult(value: { data: unknown; error: unknown }) {
  rpcRetainedShippingResult = value;
}

function resetGigDeliveryFeeMocks() {
  vi.clearAllMocks();
  mockCreateDedicatedVirtualAccount.mockResolvedValue({
    account_name: 'Test Store / John Doe',
    account_number: '1234567890',
    bank_name: 'Wema Bank',
  });
  rpcRetainedShippingResult = { data: 0, error: null };
  featureSettingsResult = { data: null, error: null };
  routeMocks.authenticateApiRequest.mockResolvedValue({ user: null });
  routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
    available: false,
    reason: 'provider_evidence_unavailable',
  });
  rpcCalls.length = 0;
  serverClientRpcNames.length = 0;
}

export {
  enableDvaForTest,
  MERCHANT_ID,
  makeRequest,
  mockCreateDedicatedVirtualAccount,
  mockInitializePaystack,
  ORDER_ID,
  POST,
  resetGigDeliveryFeeMocks,
  rpcCalls,
  serverClientRpcNames,
  setRetainedShippingResult,
  validBody,
};
