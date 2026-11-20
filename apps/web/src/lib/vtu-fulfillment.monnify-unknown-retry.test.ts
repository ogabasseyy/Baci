import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';

const mockPurchaseAirtime = vi.fn();
const mockMonnifyPurchaseBill = vi.fn();
const mockMonnifyCheckTransactionStatus = vi.fn();

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
  checkTransactionStatus: vi.fn(),
}));

vi.mock('@/lib/kuda-bills', () => ({ purchaseBill: vi.fn() }));

vi.mock('@/lib/monnify-bills', () => ({
  purchaseBill: (...args: unknown[]) => mockMonnifyPurchaseBill(...args),
  checkTransactionStatus: (...args: unknown[]) =>
    mockMonnifyCheckTransactionStatus(...args),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyCustomer: vi.fn().mockResolvedValue({ errors: [], failed: 0, sent: 1 }),
}));
vi.mock('@/lib/zeptomail', () => ({ sendEmail: vi.fn() }));

import { createPendingTransactionSupabaseMock } from './vtu-fulfillment.test-support';

describe('bugfix: an unknown Monnify requery never re-vends or refunds a failed row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns without a second vend and without a refund RPC', async () => {
    mockMonnifyCheckTransactionStatus.mockResolvedValue({
      status: 'unknown',
      message: 'Transaction not found',
    });
    const rpcImpl = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        transaction_id: 'MFBP-1',
        status: 'failed',
        source: 'checkout',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          monnifyVendReference: 'MFBP-1',
        },
        error_message: 'Monnify rejected the bill payment request',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      rpcImpl,
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: true,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(mockMonnifyPurchaseBill).not.toHaveBeenCalled();
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(
      rpcImpl.mock.calls.filter(([name]) =>
        [
          'refund_customer_wallet_for_vtu',
          'reverse_vtu_wallet_payment',
        ].includes(name as string)
      )
    ).toEqual([]);
  });
});
