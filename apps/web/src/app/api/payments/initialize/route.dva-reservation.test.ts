import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateDedicatedVirtualAccount = vi.fn();
const mockPersistPaystackDvaAssignment = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));
vi.mock('nanoid', () => ({ customAlphabet: () => () => 'ABCD12345678' }));
vi.mock('@/lib/agentic/paystack', () => ({
  createDedicatedVirtualAccount: (...args: unknown[]) =>
    mockCreateDedicatedVirtualAccount(...args),
}));
vi.mock('@/lib/payments/persist-paystack-dva-assignment', () => ({
  persistPaystackDvaAssignment: (...args: unknown[]) =>
    mockPersistPaystackDvaAssignment(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/paystack', () => ({
  initializeTransaction: vi.fn(),
  calculatePlatformFee: (amount: number) => ({
    platformFee: Math.round(amount * 0.015),
    merchantAmount: amount - Math.round(amount * 0.015),
  }),
}));
vi.mock('@/lib/korapay', () => ({
  initializePayment: vi.fn(),
  calculatePlatformFee: (amount: number) => ({
    platformFee: amount * 0.015,
    merchantAmount: amount * 0.985,
  }),
  SUPPORTED_CURRENCIES: ['NGN'],
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
  generatePaymentReference: vi.fn(),
  getChainConfirmationTime: vi.fn(),
  isSupportedCurrency: vi.fn(() => false),
  JUICYWAY_CHAIN_SUPPORT: {},
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const orderId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createAdminClientMock() {
  return {
    rpc: vi.fn((name: string) => {
      if (name === 'get_order_payment_snapshot') {
        return Promise.resolve({
          data: [
            { merchant_id: merchantId, total: 5000, tracking_token: 'token' },
          ],
          error: null,
        });
      }
      if (name === 'create_payment_transaction') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve(
                table === 'orders'
                  ? { data: { wallet_amount_used: 0 }, error: null }
                  : { data: null, error: null }
              ),
          }),
          single: () =>
            Promise.resolve(
              table === 'merchants'
                ? {
                    data: {
                      id: merchantId,
                      business_name: 'Test Store',
                      slug: 'test-store',
                      paystack_subaccount_code: 'ACCT_TEST',
                    },
                    error: null,
                  }
                : table === 'merchant_feature_settings'
                  ? { data: { wallet_paystack_dva_enabled: true }, error: null }
                  : { data: null, error: null }
            ),
        }),
      }),
    }),
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));

import { POST } from './route';

function request() {
  return new NextRequest('http://localhost:3000/api/payments/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      order_id: orderId,
      amount: 5000,
      currency: 'NGN',
      customer_email: 'customer@example.com',
      customer_name: 'John Doe',
      customer_phone: '08012345678',
      gateway: 'paystack',
      payment_type: 'dva',
      billing_address: { line1: '123 Main St', city: 'Lagos', country: 'NG' },
    }),
  });
}

describe('POST /api/payments/initialize DVA reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDedicatedVirtualAccount.mockResolvedValue({
      account_name: 'Test Store / John Doe',
      account_number: '1234567890',
      bank_name: 'Wema Bank',
    });
    mockPersistPaystackDvaAssignment.mockResolvedValue(null);
  });

  it('passes the generated DVA and customer identity to atomic persistence', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mockPersistPaystackDvaAssignment).toHaveBeenCalledWith(
      expect.anything(),
      {
        accountName: 'Test Store / John Doe',
        accountNumber: '1234567890',
        bankName: 'Wema Bank',
        customerEmail: 'customer@example.com',
        orderId,
      }
    );
  });

  it('does not advertise the DVA when atomic persistence fails closed', async () => {
    mockPersistPaystackDvaAssignment.mockResolvedValue(
      NextResponse.json(
        {
          error: 'Unable to prepare bank transfer',
          code: 'DVA_PERSISTENCE_FAILED',
        },
        { status: 503 }
      )
    );
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: 'DVA_PERSISTENCE_FAILED' });
    expect(body.dva).toBeUndefined();
  });
});
