import { describe, expect, it, vi } from 'vitest';
import {
  markAgenticCheckoutOrderCanceled,
  sendAgenticOrderCreatedWebhook,
} from './checkout-order-lifecycle';

const sendWebhook = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/lib/agentic/webhooks', () => ({
  sendAgenticWebhook: sendWebhook,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

describe('sendAgenticOrderCreatedWebhook', () => {
  it('fans out a pending order.created event', () => {
    sendAgenticOrderCreatedWebhook({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'B',
        last_name: 'U',
        phone_number: '0800',
      },
      currency: 'NGN',
      orderId: 'order-1',
      sessionId: 'session-1',
      total: 500,
    });
    expect(sendWebhook).toHaveBeenCalledWith('order.created', {
      id: 'order-1',
      currency: 'NGN',
      total: 500,
      status: 'pending',
      buyer: expect.objectContaining({ email: 'buyer@example.com' }),
    });
  });
});

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['update', 'eq', 'in', 'select']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  return { from: vi.fn(() => chain) };
}

describe('markAgenticCheckoutOrderCanceled', () => {
  it('reports updated only when a still-pending row was canceled', async () => {
    const supabase = fakeSupabase({ data: { id: 'order-1' }, error: null });
    await expect(
      markAgenticCheckoutOrderCanceled({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        sessionId: 'session-1',
        supabase: supabase as never,
      })
    ).resolves.toEqual({ error: null, updated: true });
    expect(supabase.from).toHaveBeenCalledWith('orders');
  });

  it('reports not updated when the order already settled', async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    await expect(
      markAgenticCheckoutOrderCanceled({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        sessionId: 'session-1',
        supabase: supabase as never,
      })
    ).resolves.toEqual({ error: null, updated: false });
  });
});
