import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from '@/lib/zeptomail';
import { sendImmediateOrderConfirmationEmail } from './confirmation-email';

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(() => '<p>html</p>'),
  generateOrderConfirmationText: vi.fn(() => 'text'),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockedSendEmail = vi.mocked(sendEmail);

function baseContext() {
  return {
    supabase: {},
    order: { id: 'order-1', amount_paid: 0 },
    orderNum: 'BAC-001',
    merchant: { business_name: 'Test Store', slug: 'test-store' },
    merchantId: 'merchant-1',
    customerEmail: 'buyer@example.com',
    customerName: 'Ada Buyer',
    effectivePaymentMethod: 'paystack',
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
    paymentLink: 'https://pay.example.com',
    shippingAddress: {},
  } as never;
}

describe('sendImmediateOrderConfirmationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendEmail.mockResolvedValue({ success: true } as never);
  });

  it('sends the confirmation to the customer with the email subject', async () => {
    await sendImmediateOrderConfirmationEmail(baseContext(), {
      attachments: undefined,
      invoiceVirtualAccount: null as never,
    });

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        toName: 'Ada Buyer',
        subject: 'Order confirmed',
        emailType: 'orders',
      })
    );
  });

  it('forwards attachments without failing the send', async () => {
    const attachments = [
      { name: 'invoice.pdf', content: 'base64', mime_type: 'application/pdf' },
    ];
    await sendImmediateOrderConfirmationEmail(baseContext(), {
      attachments,
      invoiceVirtualAccount: null as never,
    });

    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ attachments })
    );
  });

  it('rejects a failed provider delivery so the claim completes as failed', async () => {
    mockedSendEmail.mockResolvedValue({ success: false } as never);

    await expect(
      sendImmediateOrderConfirmationEmail(baseContext(), {
        attachments: undefined,
        invoiceVirtualAccount: null as never,
      })
    ).rejects.toThrow('ORDER_CONFIRMATION_EMAIL_FAILED');
  });
});
