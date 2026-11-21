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

function monnifyHttpError(status: number, statusText: string, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

async function runFreshVend() {
  const rpcImpl = vi.fn().mockResolvedValue({ data: null, error: null });
  const updatePayloads: Record<string, unknown>[] = [];
  const supabase = createPendingTransactionSupabaseMock({
    transactionRow: airtimeRow(),
    rpcImpl,
    updatePayloads,
  });
  const result = await fulfillPendingVtuTransaction({
    supabase,
    transactionId: 'vtu-1',
  });
  return { result, rpcImpl, updatePayloads };
}

function refundCalls(rpcImpl: ReturnType<typeof vi.fn>) {
  return rpcImpl.mock.calls.filter(([name]) => REFUND_RPCS.includes(name));
}

describe('bugfix: Monnify answers that do not prove failure are held, not refunded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    [
      'code 99 ("unexpected error, re-query")',
      () =>
        monnifyAnswers({
          requestSuccessful: false,
          responseCode: '99',
          responseMessage: 'Unexpected error, please re-query',
        }),
    ],
    [
      'a vend still in progress',
      () =>
        monnifyAnswers({
          requestSuccessful: false,
          responseCode: '01',
          responseMessage: 'Vend in progress',
        }),
    ],
    [
      'a 409 duplicate reference',
      () =>
        monnifyHttpError(409, 'Conflict', {
          responseMessage: 'Duplicate vendReference',
        }),
    ],
    [
      'a 408 timeout',
      () =>
        monnifyHttpError(408, 'Request Timeout', {
          responseMessage: 'Timed out',
        }),
    ],
    [
      'a 400 whose body shows a PENDING vend',
      () =>
        monnifyHttpError(400, 'Bad Request', {
          responseMessage: 'Request could not be completed',
          responseBody: { vendStatus: 'PENDING' },
        }),
    ],
    [
      'a success envelope with a vend state Monnify did not name',
      () =>
        monnifyAnswers({
          requestSuccessful: true,
          responseCode: '0',
          responseMessage: 'success',
          responseBody: { vendStatus: 'UNKNOWN' },
        }),
    ],
  ])('holds the row on %s: no refund, no Kuda', async (_label, answer) => {
    answer();

    const { result, rpcImpl, updatePayloads } = await runFreshVend();

    expect(result).toMatchObject({ status: 'processing' });
    expect(refundCalls(rpcImpl)).toEqual([]);
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        status: 'processing',
        transaction_id: null,
        metadata: expect.objectContaining({ monnifyOutcomeUnresolved: true }),
      })
    );
    // A held row must carry its message: an empty one would let the
    // stranded-row recovery re-vend it.
    const held = updatePayloads.findLast(
      (p) =>
        p.status === 'processing' &&
        p.metadata &&
        'monnifyOutcomeUnresolved' in (p.metadata as object)
    );
    expect(String(held?.error_message ?? '')).not.toBe('');
  });

  it("keeps Monnify's own vendReference on a held row so requery can settle it", async () => {
    monnifyAnswers({
      requestSuccessful: false,
      responseCode: '99',
      responseMessage: 'Unexpected error, please re-query',
      responseBody: { vendReference: 'MFBP-77' },
    });

    const { result, rpcImpl, updatePayloads } = await runFreshVend();

    expect(result).toMatchObject({ status: 'processing' });
    expect(refundCalls(rpcImpl)).toEqual([]);
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        status: 'processing',
        transaction_id: 'MFBP-77',
        metadata: expect.objectContaining({ monnifyVendReference: 'MFBP-77' }),
      })
    );
  });

  it.each([
    ['a plain 400 refusal', 400, 'Bad Request', 'Invalid customer reference'],
    [
      'a 401 login rejection (owner decision: refunded)',
      401,
      'Unauthorized',
      'Unauthorized',
    ],
    ['a 429 throttle', 429, 'Too Many Requests', 'Slow down'],
  ])('still fails and refunds %s', async (_label, status, statusText, message) => {
    monnifyHttpError(status, statusText, { responseMessage: message });

    const { result, rpcImpl } = await runFreshVend();

    expect(result).toMatchObject({ status: 'failed' });
    expect(refundCalls(rpcImpl).length).toBeGreaterThan(0);
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
  });

  it('still hands a known low-float refusal to Kuda', async () => {
    monnifyHttpError(400, 'Bad Request', {
      responseMessage: 'Insufficient wallet balance',
    });
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      reference: 'a1b2c3d4e5f6a1b2c3d4e5f6',
      message: 'Request successful',
      transactionId: 'kuda-1',
      amount: 100,
      status: 'successful',
    });

    const { result } = await runFreshVend();

    expect(mockPurchaseAirtime).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'successful' });
  });
});
