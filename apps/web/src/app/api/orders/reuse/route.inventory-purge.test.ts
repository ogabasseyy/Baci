import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mockReservationPurge = vi.hoisted(() => vi.fn());
vi.mock('@/lib/schedule-reused-order-inventory-purge', () => ({
  scheduleReusedOrderInventoryPurge: mockReservationPurge,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('./restamp-merchant-rate', () => ({
  restampMerchantRateOnReuse: vi.fn(),
}));

import { cookies } from 'next/headers';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';

describe('POST /api/orders/reuse inventory purge', () => {
  const mockRpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({} as never);
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(createClient).mockReturnValue({
      rpc: mockRpc,
    } as never);
  });

  it('schedules the reservation purge after a successful reuse', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'tracking-token-123',
      },
      error: null,
    });

    const request = new NextRequest('http://localhost/api/orders/reuse', {
      method: 'POST',
      body: JSON.stringify({
        order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
        merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
        tracking_token: 'tracking-token-123',
        customer_email: 'john@example.com',
        payment_method: 'card',
        shipping_provider: 'GIGL',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockReservationPurge).toHaveBeenCalledWith({
      merchantId: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
      supabase: expect.anything(),
    });
  });
});
