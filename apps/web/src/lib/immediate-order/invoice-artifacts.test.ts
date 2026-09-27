import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionInvoiceMethodDva } from '@/lib/provision-invoice-method-dva';
import { buildImmediateInvoiceArtifacts } from './invoice-artifacts';
import { loadPersistedInvoiceOrderItems } from './persisted-invoice-items';

vi.mock('./persisted-invoice-items', () => ({
  loadPersistedInvoiceOrderItems: vi.fn(),
}));

vi.mock('@/lib/provision-invoice-method-dva', () => ({
  provisionInvoiceMethodDva: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockedLoadItems = vi.mocked(loadPersistedInvoiceOrderItems);
const mockedProvisionDva = vi.mocked(provisionInvoiceMethodDva);

const mockRpc = vi.fn(async () => ({ error: null, data: null }));

function baseContext() {
  mockRpc.mockClear();
  return {
    supabase: { rpc: mockRpc },
    order: {
      id: 'order-1',
      amount_paid: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      currency: 'NGN',
    },
    orderNum: 'BAC-001',
    merchant: { business_name: 'Test Store', slug: 'test-store' },
    merchantId: 'merchant-1',
    customerEmail: 'buyer@example.com',
    customerName: 'Ada Buyer',
    customerPhone: '08010000000',
    effectivePaymentMethod: 'invoice',
    orderTotal: 5000,
    orderSubtotal: 4500,
    orderShippingFee: 500,
    orderCurrency: 'NGN',
    amountDueToGateway: 5000,
    savingsAmountUsed: 0,
    walletAmountUsed: 0,
    isWalletFullyPaid: false,
    isQuizVoucherFullyPaid: false,
    idempotencyReplayed: false,
    emailData: { customerName: 'Ada Buyer' },
    immediateEmail: {
      documentKind: 'confirmation',
      isPaidForEmail: false,
      subject: 'Order confirmed',
    },
    replyToEmail: 'support@test.store',
    paymentLink: 'https://pay.example.com/o/order-1',
    trackingToken: 'tok-1',
    shippingAddress: {
      address: '12 Market St',
      city: 'Lagos',
      state: 'Lagos',
    },
  } as never;
}

describe('buildImmediateInvoiceArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when persisted items are unavailable so the claim stays retryable', async () => {
    mockedLoadItems.mockResolvedValue(null);

    await expect(buildImmediateInvoiceArtifacts(baseContext())).rejects.toThrow(
      'PERSISTED_INVOICE_ITEMS_UNAVAILABLE'
    );
    expect(mockedProvisionDva).not.toHaveBeenCalled();
  });

  it('still resolves when the auxiliary reminder insert fails', async () => {
    mockedLoadItems.mockResolvedValue([
      {
        id: 'item-1',
        product_id: 'p1',
        name: 'Phone',
        productName: undefined,
        condition: undefined,
        variantName: undefined,
        variant_name: undefined,
        quantity: 1,
        price: 5000,
      },
    ]);
    mockedProvisionDva.mockResolvedValue({ outcome: 'skipped' });
    mockRpc.mockRejectedValueOnce(new Error('reminder boom'));

    const result = await buildImmediateInvoiceArtifacts(baseContext());

    expect(result.attachments?.[0]?.mime_type).toBe('application/pdf');
  });

  it('logs the reminder through the proof-bound insert', async () => {
    mockedLoadItems.mockResolvedValue([
      {
        id: 'item-1',
        product_id: 'p1',
        name: 'Phone',
        productName: undefined,
        condition: undefined,
        variantName: undefined,
        variant_name: undefined,
        quantity: 1,
        price: 5000,
      },
    ]);
    mockedProvisionDva.mockResolvedValue({ outcome: 'skipped' });

    const result = await buildImmediateInvoiceArtifacts(baseContext());

    expect(mockRpc).toHaveBeenCalledWith('insert_invoice_reminder', {
      p_channel: 'email',
      p_order_id: 'order-1',
      p_payment_link: 'https://pay.example.com/o/order-1',
      p_tracking_token: 'tok-1',
    });
    expect(result.attachments?.[0]?.mime_type).toBe('application/pdf');
  });
});
