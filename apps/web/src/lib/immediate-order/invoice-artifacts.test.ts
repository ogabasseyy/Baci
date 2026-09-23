import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionInvoiceMethodDva } from '@/lib/provision-invoice-method-dva';
import { buildImmediateInvoiceArtifacts } from './invoice-artifacts';
import { loadPersistedInvoiceOrderItems } from './persisted-invoice-items';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null })),
    })),
  })),
}));

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

function baseContext() {
  return {
    supabase: {},
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

  it('degrades gracefully when persisted items are unavailable', async () => {
    mockedLoadItems.mockResolvedValue(null);

    const result = await buildImmediateInvoiceArtifacts(baseContext());

    expect(result).toEqual({
      attachments: undefined,
      emailedInvoiceTypeCode: undefined,
      invoiceVirtualAccount: null,
    });
    expect(mockedProvisionDva).not.toHaveBeenCalled();
  });
});
