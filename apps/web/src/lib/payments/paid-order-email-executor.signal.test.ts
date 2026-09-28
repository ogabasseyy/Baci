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

const order = {
  currency: 'NGN',
  customer_email: 'jane@example.com',
  customer_id: 'customer-1',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: 'BAC-1',
  payment_status: 'paid',
  shipping_fee: 500,
  subtotal: 20_000,
  total: 20_500,
} as RichPaidOrder;

describe('buildEmailExecutor abort signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ messageId: 'msg-1', success: true });
  });

  it('forwards the abort signal to the confirmation send', async () => {
    const signal = AbortSignal.timeout(1000);

    await buildEmailExecutor({
      actor: 'cron:reconcile-gateway-paid-orders:drain',
      merchantDetails,
      merchantFetchError: null,
      order,
      signal,
    })(null as unknown as StepContext);

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ signal })
    );
  });
});
