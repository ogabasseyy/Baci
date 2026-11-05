import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithCsrf } from '@/lib/api-client';
import { prepareSharedCartCheckout } from './shared-cart-client';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { date: new Date().toUTCString() },
    status: 200,
  });
}

describe('shared-cart-client checkout session expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const reviewSnapshot = {
    cartId: '22222222-2222-4222-8222-222222222222',
    cartVersion: 3,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    estimates: {
      currency: 'NGN',
      lineCount: 1,
      subtotalMinor: 25000,
      unavailableCount: 0,
    },
    generation: 1,
    lines: [],
    merchantId: '11111111-1111-4111-8111-111111111111',
  };

  it.each([
    undefined,
    'not-a-date',
    new Date(Date.now() - 1000).toISOString(),
  ])('fails closed when the prepare response has invalid or expired session expiry %s', async (sessionExpiresAt) => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({
        replayed: false,
        sessionExpiresAt,
        sessionReused: false,
        snapshot: reviewSnapshot,
      })
    );

    await expect(
      prepareSharedCartCheckout({
        cartId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 3,
        operationId: 'prep-op-expiry',
      })
    ).resolves.toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    });
  });

  it('uses the response server clock and subtracts full request transit time', async () => {
    const serverNow = '2026-11-05T20:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T21:00:00.000Z'));
    const response = new Response(
      JSON.stringify({
        replayed: false,
        sessionExpiresAt: '2026-11-05T20:01:00.000Z',
        sessionReused: false,
        snapshot: reviewSnapshot,
      }),
      {
        headers: { date: new Date(serverNow).toUTCString() },
        status: 200,
      }
    );
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(response);
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(10).mockReturnValueOnce(20_010);

    try {
      const result = await prepareSharedCartCheckout({
        cartId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 3,
        operationId: 'prep-op-clock-skew',
      });
      expect(result).toMatchObject({
        ok: true,
        sessionExpiresAtMonotonicMs: 59_010,
      });
    } finally {
      nowSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('rejects a session whose TTL elapsed while the response body was parsed', async () => {
    const response = new Response(
      JSON.stringify({
        replayed: false,
        sessionExpiresAt: '2026-11-05T20:01:00.000Z',
        sessionReused: false,
        snapshot: reviewSnapshot,
      }),
      {
        headers: { date: new Date('2026-11-05T20:00:00.000Z').toUTCString() },
        status: 200,
      }
    );
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(response);
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20_010)
      .mockReturnValue(80_000);

    try {
      await expect(
        prepareSharedCartCheckout({
          cartId: '22222222-2222-4222-8222-222222222222',
          expectedVersion: 3,
          operationId: 'prep-op-body-delay',
        })
      ).resolves.toMatchObject({
        code: 'temporarily_unavailable',
        ok: false,
        retryable: true,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });
});
