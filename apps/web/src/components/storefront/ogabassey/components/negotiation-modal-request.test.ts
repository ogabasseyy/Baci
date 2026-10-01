import { AuthSessionMissingError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertNegotiationRequest } from './negotiation-modal-request';
import { NegotiationValidationError } from './negotiation-validation-error';

const insert = vi.fn();
const getUser = vi.fn();
const from = vi.fn();

function createSupabaseMock() {
  return {
    auth: { getUser },
    from,
  } as never;
}

describe('insertNegotiationRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    getUser.mockResolvedValue({
      data: {
        user: {
          email: 'account@example.com',
          id: 'user-1',
          phone: null,
        },
      },
      error: null,
    });
    insert.mockResolvedValue({ error: null });
    from.mockReturnValue({ insert });
  });

  it('inserts normalized single-product negotiation requests', async () => {
    await insertNegotiationRequest(createSupabaseMock(), {
      currentPrice: 10_000,
      customerEmail: ' Buyer@Example.COM ',
      customerPhone: '0803 123 4567',
      evidenceUrl: 'merchant-1/evidence.png',
      itemId: 'product-1',
      merchantId: 'merchant-1',
      offeredPrice: 9000,
      productName: 'Test Product',
      type: 'single',
    });

    expect(from).toHaveBeenCalledWith('negotiation_requests');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'buyer@example.com',
        customer_id: 'user-1',
        customer_phone: '2348031234567',
        evidence_url: 'merchant-1/evidence.png',
        merchant_id: 'merchant-1',
        offered_price: 9000,
        session_id: expect.stringMatching(/^web-/),
        status: 'pending',
        type: 'single',
      })
    );
  });

  it('rejects invalid contact details before database insert', async () => {
    await expect(
      insertNegotiationRequest(createSupabaseMock(), {
        currentPrice: 10_000,
        customerPhone: 'not a phone',
        itemId: 'product-1',
        merchantId: 'merchant-1',
        offeredPrice: 9000,
        productName: 'Test Product',
        type: 'single',
      })
    ).rejects.toBeInstanceOf(NegotiationValidationError);

    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a guest negotiation without a delivery channel', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    await expect(
      insertNegotiationRequest(createSupabaseMock(), {
        currentPrice: 10_000,
        itemId: 'product-1',
        merchantId: 'merchant-1',
        offeredPrice: 9000,
        productName: 'Test Product',
        type: 'single',
      })
    ).rejects.toThrow(
      "Provide an email address or Phone / WhatsApp number so we can send the merchant's decision."
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it('allows a guest negotiation when Supabase reports a missing session', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    await insertNegotiationRequest(createSupabaseMock(), {
      currentPrice: 10_000,
      customerPhone: '0803 123 4567',
      itemId: 'product-1',
      merchantId: 'merchant-1',
      offeredPrice: 9000,
      productName: 'Test Product',
      type: 'single',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: null,
        customer_phone: '2348031234567',
      })
    );
  });

  it('persists verified account contact for an authenticated request', async () => {
    await insertNegotiationRequest(createSupabaseMock(), {
      currentPrice: 10_000,
      customerId: 'user-1',
      itemId: 'product-1',
      merchantId: 'merchant-1',
      offeredPrice: 9000,
      productName: 'Test Product',
      type: 'single',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'account@example.com',
        customer_id: 'user-1',
        customer_phone: null,
      })
    );
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('preserves an E.164 account phone when account email and form contact are blank', async () => {
    getUser.mockResolvedValueOnce({
      data: {
        user: { email: null, id: 'user-1', phone: '15551234567' },
      },
      error: null,
    });
    const request = {
      currentPrice: 10_000,
      customerId: 'user-1',
      itemId: 'product-1',
      merchantId: 'merchant-1',
      offeredPrice: 9000,
      productName: 'Test Product',
      type: 'single' as const,
    };

    await insertNegotiationRequest(createSupabaseMock(), request);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: null,
        customer_id: 'user-1',
        customer_phone: '15551234567',
      })
    );
  });

  it('rejects an authenticated request when account and form have no contact', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: { email: null, id: 'user-1', phone: null } },
      error: null,
    });
    const request = {
      currentPrice: 10_000,
      customerId: 'user-1',
      itemId: 'product-1',
      merchantId: 'merchant-1',
      offeredPrice: 9000,
      productName: 'Test Product',
      type: 'single' as const,
    };

    const result = insertNegotiationRequest(createSupabaseMock(), request);

    await expect(result).rejects.toThrow(
      "Provide an email address or Phone / WhatsApp number so we can send the merchant's decision."
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a caller-supplied customer id that does not match the session', async () => {
    const request = {
      currentPrice: 10_000,
      customerId: 'another-user',
      itemId: 'product-1',
      merchantId: 'merchant-1',
      offeredPrice: 9000,
      productName: 'Test Product',
      type: 'single' as const,
    };

    const result = insertNegotiationRequest(createSupabaseMock(), request);

    await expect(result).rejects.toThrow(
      'Customer session changed. Please try again.'
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it('fails closed when authentication lookup returns an unexpected error', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('auth unavailable'),
    });

    await expect(
      insertNegotiationRequest(createSupabaseMock(), {
        currentPrice: 10_000,
        customerEmail: 'buyer@example.com',
        itemId: 'product-1',
        merchantId: 'merchant-1',
        offeredPrice: 9000,
        productName: 'Test Product',
        type: 'single',
      })
    ).rejects.toThrow('auth unavailable');

    expect(insert).not.toHaveBeenCalled();
  });

  it('surfaces Supabase insert failures', async () => {
    insert.mockResolvedValueOnce({
      error: new Error('insert failed'),
    });

    await expect(
      insertNegotiationRequest(createSupabaseMock(), {
        currentPrice: 10_000,
        customerEmail: 'buyer@example.com',
        itemId: 'product-1',
        merchantId: 'merchant-1',
        offeredPrice: 9000,
        productName: 'Test Product',
        type: 'single',
      })
    ).rejects.toThrow('insert failed');
  });

  it('continues with a generated guest session when sessionStorage is blocked', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    getItem.mockImplementationOnce(() => {
      throw new Error('storage blocked');
    });

    await insertNegotiationRequest(createSupabaseMock(), {
      currentPrice: 10_000,
      customerPhone: '0803 123 4567',
      itemId: 'product-1',
      merchantId: 'merchant-1',
      offeredPrice: 9000,
      productName: 'Test Product',
      type: 'single',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: expect.stringMatching(/^web-/),
      })
    );
    expect(setItem).not.toHaveBeenCalled();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('fails closed when a total-cart request has no cart snapshot', async () => {
    await expect(
      insertNegotiationRequest(createSupabaseMock(), {
        currentPrice: 10_000,
        customerEmail: 'buyer@example.com',
        merchantId: 'merchant-1',
        offeredPrice: 9000,
        productName: 'Entire Cart',
        type: 'total',
      })
    ).rejects.toThrow('Whole-cart negotiations require at least one cart item.');

    expect(insert).not.toHaveBeenCalled();
  });
});
