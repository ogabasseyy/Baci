import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPurchaseAirtime = vi.fn();
const mockKudaCheckTransactionStatus = vi.fn();

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));
vi.mock('@/lib/kuda', () => ({
  NetworkProvider: {
    MTN: 'MTN',
    AIRTEL: 'AIRTEL',
    GLO: 'GLO',
    MOBILE_9: '9MOBILE',
  },
  purchaseAirtime: (...args: unknown[]) => mockPurchaseAirtime(...args),
  purchaseData: vi.fn(),
  formatPhoneNumber: (value: string) => value.replace(/\D/g, ''),
  isValidPhoneNumber: () => true,
  checkTransactionStatus: (...args: unknown[]) =>
    mockKudaCheckTransactionStatus(...args),
}));
vi.mock('@/lib/kuda-bills', () => ({ purchaseBill: vi.fn() }));
vi.mock('@/lib/expo-push', () => ({
  notifyCustomer: vi.fn().mockResolvedValue({ errors: [], failed: 0, sent: 1 }),
}));
vi.mock('@/lib/zeptomail', () => ({ sendEmail: vi.fn() }));

import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { createPendingTransactionSupabaseMock } from './vtu-fulfillment.test-support';

const REFUND_RPCS = [
  'refund_customer_wallet_for_vtu',
  'reverse_vtu_wallet_payment',
];

function airtimeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vtu-1',
    merchant_id: 'merchant-1',
    customer_id: 'customer-1',
    type: 'airtime',
    network_provider: 'MTN',
    phone_number: '08012345678',
    amount: 100,
    request_reference: 'a1b2c3d4e5f6a1b2c3d4e5f6',
    transaction_id: null,
    status: 'pending',
    source: 'checkout',
    metadata: {
      provider: 'monnify',
      billerCode: 'MTN',
      productCode: '13',
      requireValidationRef: false,
      paymentSplit: { card: 100, wallet: 0 },
      walletDebited: true,
    },
    error_message: null,
    merchant_commission: 0,
    customer_cashback: 0,
    biller_name: null,
    biller_item_code: null,
    customer_identifier: '08012345678',
    ...overrides,
  };
}

function monnifyAnswers(answer: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(answer),
  });
}

function refundCalls(rpcImpl: ReturnType<typeof vi.fn>) {
  return rpcImpl.mock.calls.filter(([name]) => REFUND_RPCS.includes(name));
}

describe('bugfix: a requery that does not prove failure never refunds a processing row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  async function reconcile() {
    const rpcImpl = vi.fn().mockResolvedValue({ data: null, error: null });
    const updatePayloads: Record<string, unknown>[] = [];
    const row = airtimeRow({
      status: 'processing',
      transaction_id: 'MFBP-77',
      error_message: 'Vend in progress',
      metadata: {
        ...airtimeRow().metadata,
        monnifyVendReference: 'MFBP-77',
        walletDebited: true,
      },
    });
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: row,
      currentTransactionData: row,
      rpcImpl,
      updatePayloads,
    });
    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });
    return { result, rpcImpl };
  }

  it('leaves the row processing when the requery answers code 99', async () => {
    monnifyAnswers({
      requestSuccessful: false,
      responseCode: '99',
      responseMessage: 'Transaction failed unexpectedly, please re-query',
    });

    const { result, rpcImpl } = await reconcile();

    expect(result).toMatchObject({ status: 'processing' });
    expect(refundCalls(rpcImpl)).toEqual([]);
  });

  it('leaves the row processing when the requery reports "not found"', async () => {
    monnifyAnswers({
      requestSuccessful: false,
      responseCode: '01',
      responseMessage: 'Transaction not found or failed',
    });

    const { result, rpcImpl } = await reconcile();

    expect(result).toMatchObject({ status: 'processing' });
    expect(refundCalls(rpcImpl)).toEqual([]);
  });

  it('still refunds when the requery says the vend FAILED', async () => {
    monnifyAnswers({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: { vendReference: 'MFBP-77', vendStatus: 'FAILED' },
    });

    const { result, rpcImpl } = await reconcile();

    expect(result).toMatchObject({ status: 'failed' });
    expect(refundCalls(rpcImpl).length).toBeGreaterThan(0);
  });
});
