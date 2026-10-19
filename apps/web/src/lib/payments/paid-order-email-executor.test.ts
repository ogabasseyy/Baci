import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepContext } from '@/lib/payments/apply-paid-order-side-effects';
import { buildEmailExecutor } from '@/lib/payments/paid-order-email-executor';
import type {
  MerchantDetails,
  RichPaidOrder,
} from '@/lib/payments/paid-order-side-effect-types';

const mocks = vi.hoisted(() => ({
  generateOrderConfirmationEmail: vi.fn(() => '<p>receipt</p>'),
  generateOrderConfirmationText: vi.fn(() => 'receipt'),
  sendEmail: vi.fn(),
}));

vi.mock('@/env', () => ({
  env: { NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.test' },
}));

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: mocks.generateOrderConfirmationEmail,
  generateOrderConfirmationText: mocks.generateOrderConfirmationText,
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: mocks.sendEmail,
}));

const merchantDetails: MerchantDetails = {
  business_name: 'Ogabassey',
  cac_rc_number: 'RC123',
  email: 'merchant@example.com',
  email_sender_name: 'Bassey Store',
  slug: 'ogabassey',
  support_email: 'support@example.com',
  tax_identification_number: 'TIN123',
};

const richOrder: RichPaidOrder = {
  currency: 'NGN',
  customer_email: 'jane@example.com',
  customer_id: 'customer-1',
  customer_name: 'Jane Doe',
  customer_phone: '+2348012345678',
  discount_amount: 0,
  gift_wrapping_fee: 0,
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [
    {
      condition: 'open_box',
      id: 'item-1',
      name: 'iPhone',
      price: '20000',
      product_id: 'product-1',
      quantity: 1,
      variant_name: 'Black',
    },
  ],
  order_number: 'BAC-1',
  payment_status: 'paid',
  shipping_address: { address: '1 Baci Way', city: 'Lagos', state: 'LA' },
  shipping_fee: 500,
  subtotal: 20_000,
  tax_amount: 0,
  tax_basis: 'exclusive',
  total: 20_500,
};

const stepContext: StepContext = {
  consistency: { consistent: true },
  gatewayResponse: {},
  order: richOrder,
  transaction: {
    amount: 20_500,
    gateway_reference: 'WALLET-DVA-ORDER-order-1',
    id: 'txn-order-1',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
  },
};

describe('buildEmailExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ messageId: 'msg-1', success: true });
  });

  it('sends the order confirmation email and returns the message id', async () => {
    const result = await buildEmailExecutor({
      actor: 'webhook:paystack',
      merchantDetails,
      merchantFetchError: null,
      order: richOrder,
    })(stepContext);

    expect(result).toEqual({ messageId: 'msg-1' });
    expect(mocks.generateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'NGN',
        items: [
          { name: 'iPhone (Open Box / Black)', price: 20_000, quantity: 1 },
        ],
        merchantUrl: 'https://ogabassey.usebaci.test',
        orderNumber: 'BAC-1',
      })
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        clientReference: 'order:order-1:paid_email',
        fromName: 'Bassey Store Orders',
        replyTo: 'support@example.com',
        to: 'jane@example.com',
      })
    );
  });

  it('bounds the platform-sender fallback to the pass deadline', async () => {
    await buildEmailExecutor({
      actor: 'cron:reconcile-gateway-paid-orders',
      fallbackDeadlineMs: 1_700_000,
      merchantDetails,
      merchantFetchError: null,
      order: richOrder,
    })(stepContext);

    // Without the bound the fallback loop can overrun the pass and the
    // finalize signal aborts mid-send, stranding the step
    // delivery_uncertain instead of retrying next sweep.
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDeadlineMs: 1_700_000 })
    );
  });

  it('threads a non-NGN order currency through to the confirmation email', async () => {
    await buildEmailExecutor({
      actor: 'webhook:paystack',
      merchantDetails,
      merchantFetchError: null,
      order: { ...richOrder, currency: 'INR' },
    })(stepContext);

    expect(mocks.generateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'INR' })
    );
    expect(mocks.generateOrderConfirmationText).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'INR' })
    );
  });

  it('falls back to NGN when the order currency is missing', async () => {
    await buildEmailExecutor({
      actor: 'webhook:paystack',
      merchantDetails,
      merchantFetchError: null,
      order: { ...richOrder, currency: null },
    })(stepContext);

    expect(mocks.generateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'NGN' })
    );
  });

  it('skips when merchant details or customer email are missing', async () => {
    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails: null,
        merchantFetchError: null,
        order: richOrder,
      })(stepContext)
    ).resolves.toEqual({ skipped: 'missing_merchant_or_customer_email' });
    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails,
        merchantFetchError: null,
        order: { ...richOrder, customer_email: null },
      })(stepContext)
    ).resolves.toEqual({ skipped: 'missing_merchant_or_customer_email' });
    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails: null,
        merchantFetchError: { code: 'PGRST116', message: 'not found' },
        order: richOrder,
      })(stepContext)
    ).resolves.toEqual({ skipped: 'missing_merchant_or_customer_email' });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to root merchant URLs and reply-to when merchant slug is missing', async () => {
    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails: {
          ...merchantDetails,
          email: null,
          slug: null,
          support_email: null,
        },
        merchantFetchError: null,
        order: richOrder,
      })(stepContext)
    ).resolves.toEqual({ messageId: 'msg-1' });

    expect(mocks.generateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantUrl: 'https://usebaci.test',
      })
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: 'support@usebaci.test',
      })
    );
  });

  it('ignores invalid reply-to source fields before generating a fallback', async () => {
    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails: {
          ...merchantDetails,
          email: 'not-an-email',
          slug: 'bad slug!',
          support_email: 'also-invalid',
        },
        merchantFetchError: null,
        order: richOrder,
      })(stepContext)
    ).resolves.toEqual({ messageId: 'msg-1' });

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: 'support@usebaci.test',
      })
    );
  });

  it('throws on merchant fetch, invalid payload, and send failures', async () => {
    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails,
        merchantFetchError: { code: '500', message: 'merchant failed' },
        order: richOrder,
      })(stepContext)
    ).rejects.toThrow('merchant_fetch_error: merchant failed');

    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails,
        merchantFetchError: null,
        order: { ...richOrder, customer_email: 'not-an-email' },
      })(stepContext)
    ).rejects.toThrow('invalid_order_for_paid_email');

    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails: {
          ...merchantDetails,
          business_name: undefined,
        } as unknown as MerchantDetails,
        merchantFetchError: null,
        order: richOrder,
      })(stepContext)
    ).rejects.toThrow('invalid_merchant_details_for_paid_email');

    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails: {
          ...merchantDetails,
          unexpected: 'field',
        } as unknown as MerchantDetails,
        merchantFetchError: null,
        order: richOrder,
      })(stepContext)
    ).rejects.toThrow('invalid_merchant_details_for_paid_email');

    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails,
        merchantFetchError: null,
        order: {
          ...richOrder,
          order_items: [
            {
              name: 'iPhone',
              price: '20000',
              quantity: 1,
              unexpected: 'field',
              variant_name: 'Black',
            },
          ],
        } as unknown as RichPaidOrder,
      })(stepContext)
    ).rejects.toThrow('invalid_order_for_paid_email');

    mocks.sendEmail.mockResolvedValueOnce({
      error: 'zepto failed',
      success: false,
    });
    await expect(
      buildEmailExecutor({
        actor: 'webhook:paystack',
        merchantDetails,
        merchantFetchError: null,
        order: richOrder,
      })(stepContext)
    ).rejects.toThrow('zepto failed');
  });
});
