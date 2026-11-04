import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/zeptomail', () => ({ sendEmail }));

import { sendDeliveryExceptionNotification } from './order-fulfillment-delivered-sender';

const merchant = {
  business_name: 'Shop',
  slug: 'shop',
  support_email: 'help@shop.com',
  email_sender_name: null,
  email: 'o@shop.com',
} as never;
const order = {
  id: 'o1',
  order_number: 'A-1',
  customer_id: 'c1',
  customer_name: 'Ada',
  customer_email: 'ada@example.com',
  tracking_token: 'tok',
  order_items: [],
} as never;

describe('sendDeliveryExceptionNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockResolvedValue({ success: true, messageId: 'm1' });
  });

  it('emails the customer about a failed delivery', async () => {
    const result = await sendDeliveryExceptionNotification({
      kind: 'failed',
      merchant,
      merchantId: 'm',
      order,
    });
    expect(result).toMatchObject({ status: 'sent' });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ada@example.com',
        subject: 'Delivery problem with your order #A-1',
        clientReference: 'order:o1:delivery_failed_email',
      })
    );
  });

  it('emails the customer about a returned order', async () => {
    await sendDeliveryExceptionNotification({
      kind: 'returned',
      merchant,
      merchantId: 'm',
      order,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Your order #A-1 is being returned',
        clientReference: 'order:o1:returned_email',
      })
    );
  });

  it('skips when the order has no valid customer email', async () => {
    const result = await sendDeliveryExceptionNotification({
      kind: 'failed',
      merchant,
      merchantId: 'm',
      order: { ...(order as object), customer_email: null } as never,
    });
    expect(result.status).toBe('skipped');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reports a provider failure', async () => {
    sendEmail.mockResolvedValue({ success: false, error: 'boom' });
    const result = await sendDeliveryExceptionNotification({
      kind: 'failed',
      merchant,
      merchantId: 'm',
      order,
    });
    expect(result.status).toBe('failed');
  });
});
