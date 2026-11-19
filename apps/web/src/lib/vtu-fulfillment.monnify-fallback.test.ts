import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';

const mockPurchaseAirtime = vi.fn();
const mockPurchaseData = vi.fn();
const mockCheckTransactionStatus = vi.fn();
const mockNotifyCustomer = vi.fn();
const mockPurchaseBill = vi.fn();
const mockSendEmail = vi.fn();
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
  purchaseData: (...args: unknown[]) => mockPurchaseData(...args),
  formatPhoneNumber: (value: string) => value.replace(/\D/g, ''),
  isValidPhoneNumber: (value: string) => /^0[789][01]\d{8}$/.test(value),
  checkTransactionStatus: (...args: unknown[]) =>
    mockCheckTransactionStatus(...args),
}));

vi.mock('@/lib/kuda-bills', () => ({
  purchaseBill: (...args: unknown[]) => mockPurchaseBill(...args),
}));

vi.mock('@/lib/monnify-bills', () => ({
  purchaseBill: (...args: unknown[]) => mockMonnifyPurchaseBill(...args),
  checkTransactionStatus: (...args: unknown[]) =>
    mockMonnifyCheckTransactionStatus(...args),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyCustomer: (...args: unknown[]) => mockNotifyCustomer(...args),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import { createPendingTransactionSupabaseMock } from './vtu-fulfillment.test-support';

describe('fulfillPendingVtuTransaction Monnify airtime fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPurchaseAirtime.mockReset();
    mockCheckTransactionStatus.mockReset();
    mockCheckTransactionStatus.mockResolvedValue({
      message: 'No token',
      status: 'successful',
    });
    mockNotifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    mockMonnifyPurchaseBill.mockReset();
    mockMonnifyCheckTransactionStatus.mockReset();
  });
  it('bugfix: falls back to Kuda airtime for any definite Monnify failure, not one error text', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Monnify business failure',
      amount: 100,
      status: 'failed',
      providerDefiniteFailure: true,
    });
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      reference: 'VTU-123',
      message: 'Request successful',
      transactionId: 'kuda-airtime-1',
      amount: 100,
      phoneNumber: '08012345678',
      provider: 'MTN',
      status: 'successful',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).toHaveBeenCalledWith(
      '08012345678',
      100,
      'MTN',
      expect.any(String),
      'VTU-123'
    );
    expect(result).toMatchObject({
      amount: 100,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          fulfillmentProvider: 'kuda',
          monnifyFallbackError: 'Monnify business failure',
          originalProvider: 'monnify',
          providerFallback: 'monnify_airtime_to_kuda',
        }),
        status: 'successful',
        transaction_id: 'kuda-airtime-1',
      })
    );
    // No provider text in logs, only a fixed label and the row id.
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      'Monnify business failure'
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), {
      transactionId: 'vtu-1',
    });
    warnSpy.mockRestore();
  });
  it('does not fall back to Kuda for a Monnify failure it did not explicitly refuse', async () => {
    // e.g. an unrecognised vend status or a duplicate vend reference: Monnify
    // may still deliver, so a Kuda vend could top the customer up twice.
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Vend request failed',
      amount: 100,
      status: 'failed',
      providerDefiniteFailure: false,
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reference: 'VTU-123', status: 'failed' });
    // No provider text in logs, only a fixed label and the row id.
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      'Vend request failed'
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), {
      transactionId: 'vtu-1',
    });
    warnSpy.mockRestore();
  });
  it('does not log a Monnify refusal when Monnify was never called', async () => {
    // e.g. an unrecognised vend status or a duplicate vend reference: Monnify
    // may still deliver, so a Kuda vend could top the customer up twice.
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockMonnifyPurchaseBill).not.toHaveBeenCalled();
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(
      'Monnify airtime failure not handed to Kuda:',
      expect.anything()
    );
    warnSpy.mockRestore();
  });
  it('restores an airtime Monnify unknown outcome to pending without calling Kuda', async () => {
    const transientError = new Error('Transient vend outcome: timeout');
    transientError.name = 'MonnifyTransientVendError';
    mockMonnifyPurchaseBill.mockRejectedValue(transientError);
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'processing' });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({ status: 'pending', transaction_id: null })
    );
  });
});
