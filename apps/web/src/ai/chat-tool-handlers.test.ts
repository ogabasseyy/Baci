import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryMock } from './chat-query.test-support';

const mocks = vi.hoisted(() => ({
  createAgenticScopedSupabaseClient: vi.fn(),
  searchStorefrontProducts: vi.fn(),
}));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: mocks.createAgenticScopedSupabaseClient,
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: mocks.searchStorefrontProducts,
}));

import { handleCheckPaymentStatus } from './chat-tool-handlers';

const OGABASSEY_MERCHANT_ID = '3bc72679-c0f7-4db4-9054-6a4a4a95a498';
describe('chat tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchStorefrontProducts.mockReset();
  });
  it('scopes payment status order lookups to the active chat session', async () => {
    const query = createQueryMock();
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await handleCheckPaymentStatus({ orderId: 'order-1' }, 'session-1');

    expect(query.eq).toHaveBeenCalledWith('id', 'order-1');
    expect(query.eq).toHaveBeenCalledWith('merchant_id', OGABASSEY_MERCHANT_ID);
    expect(query.eq).toHaveBeenCalledWith('session_id', 'session-1');
    expect(mocks.createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: OGABASSEY_MERCHANT_ID,
      merchantSlug: 'ogabassey',
      sessionId: 'session-1',
    });
  });

  it('fails closed when the scoped order lookup has no matching row', async () => {
    const query = createQueryMock({ data: null, error: null });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleCheckPaymentStatus(
      { orderId: 'order-1' },
      'session-1'
    );

    expect(result).toEqual({ status: 'not_found' });
  });

  it('fails closed when the payment status lookup rejects', async () => {
    const query = createQueryMock();
    query.maybeSingle.mockRejectedValueOnce(new Error('network unavailable'));
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleCheckPaymentStatus(
      { orderId: 'order-1' },
      'session-1'
    );

    expect(result).toEqual({ status: 'not_found' });
  });

  it('scopes payment status email lookups to the active chat session', async () => {
    const query = createQueryMock();
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await handleCheckPaymentStatus(
      { customerEmail: 'buyer@example.com' },
      'session-1'
    );

    expect(query.eq).toHaveBeenCalledWith(
      'customer_email',
      'buyer@example.com'
    );
    expect(query.eq).toHaveBeenCalledWith('merchant_id', OGABASSEY_MERCHANT_ID);
    expect(query.eq).toHaveBeenCalledWith('session_id', 'session-1');
  });

  it('returns pending payment status only from the scoped session row', async () => {
    const query = createQueryMock({
      data: {
        id: 'order-1',
        status: 'pending_payment',
        paid_at: null,
        created_at: new Date().toISOString(),
        subtotal: 150_000,
        virtual_account_number: '1234567890',
        virtual_account_bank: 'Kuda',
        metadata: null,
      },
      error: null,
    });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleCheckPaymentStatus(
      { orderId: 'order-1' },
      'session-1'
    );

    expect(result).toEqual({
      status: 'pending',
      orderId: 'order-1',
      amount: 150_000,
      accountNumber: '1234567890',
      bankName: 'Kuda',
    });
  });

  it('returns expired payment status after the 30-minute payment window', async () => {
    const query = createQueryMock({
      data: {
        id: 'order-1',
        status: 'pending_payment',
        paid_at: null,
        created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        subtotal: 150_000,
        virtual_account_number: '1234567890',
        virtual_account_bank: 'Kuda',
        metadata: null,
      },
      error: null,
    });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleCheckPaymentStatus(
      { orderId: 'order-1' },
      'session-1'
    );

    expect(result).toEqual({ status: 'expired', orderId: 'order-1' });
  });
});
