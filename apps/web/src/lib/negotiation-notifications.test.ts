// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNotifyMerchant = vi
  .fn()
  .mockResolvedValue({ sent: 1, failed: 0, errors: [] });
const mockNotifyCustomer = vi
  .fn()
  .mockResolvedValue({ sent: 1, failed: 0, errors: [] });
const mockSendEmail = vi.fn().mockResolvedValue({
  success: true,
  messageId: 'email-1',
});

vi.mock('@/lib/expo-push', () => ({
  formatCurrency: (amount: number, currency = 'NGN') =>
    new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(amount),
  notifyMerchant: (...args: unknown[]) => mockNotifyMerchant(...args),
  notifyCustomer: (...args: unknown[]) => mockNotifyCustomer(...args),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

const {
  notifyGuestNegotiationResponseByEmail,
  notifyNegotiationRequest,
  notifyNegotiationResponse,
} = await import('./negotiation-notifications');

describe('notifyNegotiationRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends single-item negotiation with discount percentage', async () => {
    await notifyNegotiationRequest(
      'm1',
      'single',
      8000,
      'n1',
      'Laptop Stand',
      10000
    );

    expect(mockNotifyMerchant).toHaveBeenCalledOnce();
    const [, title, body, data, channel] = mockNotifyMerchant.mock.calls[0];
    expect(title).toContain('Negotiation');
    expect(body).toContain('Laptop Stand');
    expect(body).toContain('20%');
    expect(body).toContain('₦8,000');
    expect(data.negotiation_id).toBe('n1');
    expect(channel).toBe('orders');
  });

  it('sends cart-level negotiation without item details', async () => {
    await notifyNegotiationRequest('m1', 'total', 25000, 'n2', null, null);

    const [, , body] = mockNotifyMerchant.mock.calls[0];
    expect(body).toContain('Cart total');
    expect(body).not.toContain('undefined');
  });

  it('handles currentPrice of 0 without divide-by-zero', async () => {
    await notifyNegotiationRequest('m1', 'single', 500, 'n3', 'Free Item', 0);

    const [, , body] = mockNotifyMerchant.mock.calls[0];
    // currentPrice === 0 is not null, so it takes the item branch
    expect(body).toContain('Free Item');
    expect(body).not.toContain('Infinity');
    expect(body).not.toContain('NaN');
  });

  it('handles currentPrice == null with cart message', async () => {
    await notifyNegotiationRequest('m1', 'single', 500, 'n4', 'Shirt', null);

    const [, , body] = mockNotifyMerchant.mock.calls[0];
    expect(body).toContain('Cart total');
  });

  it('does not show discount when offeredPrice >= currentPrice', async () => {
    await notifyNegotiationRequest('m1', 'single', 12000, 'n5', 'Watch', 10000);

    const [, , body] = mockNotifyMerchant.mock.calls[0];
    expect(body).toContain('Watch');
    expect(body).not.toContain('%');
  });
});

describe('notifyNegotiationResponse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends accepted notification for single item with price', async () => {
    await notifyNegotiationResponse(
      'u1',
      'single',
      'accepted',
      'n1',
      'Laptop Stand',
      8000
    );

    expect(mockNotifyCustomer).toHaveBeenCalledOnce();
    const [, title, body, data, channel] = mockNotifyCustomer.mock.calls[0];
    expect(title).toContain('Accepted');
    expect(body).toContain('Laptop Stand');
    expect(body).toContain('₦8,000');
    expect(data.type).toBe('negotiation_response');
    expect(data.status).toBe('accepted');
    expect(channel).toBe('orders');
  });

  it('sends rejected notification for cart-level negotiation', async () => {
    await notifyNegotiationResponse(
      'u1',
      'total',
      'rejected',
      'n2',
      null,
      null
    );

    const [, title, body] = mockNotifyCustomer.mock.calls[0];
    expect(title).toContain('Declined');
    expect(body).toContain('cart offer');
    expect(body).not.toContain('undefined');
  });

  it('sends accepted notification without price when offeredPrice is null', async () => {
    await notifyNegotiationResponse(
      'u1',
      'single',
      'accepted',
      'n3',
      'Shirt',
      null
    );

    const [, , body] = mockNotifyCustomer.mock.calls[0];
    expect(body).toContain('Shirt');
    expect(body).toContain('accepted');
    expect(body).not.toContain('₦');
  });
});

describe('notifyGuestNegotiationResponseByEmail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends accepted guest email with item and accepted price details', async () => {
    await notifyGuestNegotiationResponseByEmail({
      acceptedPrice: 820_000,
      email: 'guest@example.com',
      itemName: 'iPhone <script>alert(1)</script>',
      merchantId: 'merchant-123',
      negotiationId: 'negotiation-123',
      negotiationType: 'single',
      productSlug: 'iphone-14-pro-max',
      status: 'accepted',
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      auditContext: {
        merchantId: 'merchant-123',
        metadata: {
          negotiationId: 'negotiation-123',
          status: 'accepted',
        },
      },
      emailType: 'orders',
      merchantId: 'merchant-123',
      subject: 'Your offer has been accepted',
      to: 'guest@example.com',
    });
    expect(mockSendEmail.mock.calls[0][0].textContent).toContain(
      'iPhone <script>alert(1)</script>'
    );
    expect(mockSendEmail.mock.calls[0][0].textContent).toContain('₦820,000');
    expect(mockSendEmail.mock.calls[0][0].htmlContent).toContain(
      'iPhone &lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(mockSendEmail.mock.calls[0][0].htmlContent).not.toContain(
      '<script>alert(1)</script>'
    );
  });

  it('sends accepted guest email without price details when acceptedPrice is null', async () => {
    await notifyGuestNegotiationResponseByEmail({
      acceptedPrice: null,
      email: 'guest@example.com',
      itemName: 'iPhone 14',
      merchantId: 'merchant-123',
      negotiationId: 'negotiation-123',
      negotiationType: 'single',
      productSlug: 'iphone-14',
      status: 'accepted',
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      auditContext: {
        merchantId: 'merchant-123',
        metadata: {
          negotiationId: 'negotiation-123',
          status: 'accepted',
        },
      },
      subject: 'Your offer has been accepted',
      to: 'guest@example.com',
    });
    expect(mockSendEmail.mock.calls[0][0].textContent).toContain(
      'Your offer for iPhone 14 has been accepted.'
    );
    expect(mockSendEmail.mock.calls[0][0].textContent).not.toContain('₦');
  });

  it('throws when the email provider rejects the notification', async () => {
    mockSendEmail.mockResolvedValueOnce({
      success: false,
      error: 'provider unavailable',
    });

    await expect(
      notifyGuestNegotiationResponseByEmail({
        acceptedPrice: null,
        email: 'guest@example.com',
        itemName: null,
        merchantId: 'merchant-123',
        negotiationId: 'negotiation-123',
        negotiationType: 'total',
        productSlug: null,
        status: 'rejected',
      })
    ).rejects.toThrow('provider unavailable');
  });
});

describe('counter offer notifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes the counter amount in push content and navigation data', async () => {
    await notifyNegotiationResponse(
      'customer-1',
      'single',
      'countered',
      'n1',
      'Samsung Galaxy S21',
      220000
    );
    expect(mockNotifyCustomer).toHaveBeenCalledWith(
      'customer-1',
      '🤝 New Counter Offer',
      expect.stringContaining('220,000'),
      expect.objectContaining({
        status: 'countered',
        counter_offer: 220000,
        negotiation_id: 'n1',
      }),
      'orders'
    );
  });

  it('sends a counter offer email with the amount and escaped item name', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: true });
    await notifyGuestNegotiationResponseByEmail({
      email: 'guest@example.com',
      merchantId: 'm1',
      negotiationId: 'n1',
      negotiationType: 'single',
      status: 'countered',
      acceptedPrice: 220000,
      itemName: '<Samsung>',
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'You received a counter offer',
        textContent: expect.stringContaining('220,000'),
        htmlContent: expect.stringContaining('&lt;Samsung&gt;'),
      })
    );
  });
});
