import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverSavingsExpoPush } from './expo-delivery';

describe('deliverSavingsExpoPush', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends one token to the fixed Expo endpoint with the bounded timeout', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await deliverSavingsExpoPush({
      token: 'ExponentPushToken[hidden]',
      title: 'Title',
      body: 'Body',
      data: {
        type: 'savings',
        goalId: 'goal-1',
        notificationId: 'notification-1',
        merchantId: 'merchant-1',
      },
      channelId: 'savings',
      accessToken: 'server-only',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer server-only',
        }),
      })
    );
    expect(result).toEqual({ outcome: 'accepted', ticketId: 'ticket-1' });
  });

  it('classifies provider rejection and malformed responses safely, network failures retryable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                status: 'error',
                message: 'Rejected by Expo',
                details: { error: 'MessageTooBig' },
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockRejectedValueOnce(new Error('network timeout with token'));
    vi.stubGlobal('fetch', fetchMock);
    const input = {
      token: 'ExponentPushToken[hidden]',
      title: 'Title',
      body: 'Body',
      data: {
        type: 'savings',
        goalId: 'goal-1',
        notificationId: 'notification-1',
        merchantId: 'merchant-1',
      } as const,
      channelId: 'savings' as const,
    };

    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'rejected',
      ticketId: null,
    });
    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'unknown',
      ticketId: null,
    });
    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'retryable',
      ticketId: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports ticket-level DeviceNotRegistered as unregistered for token retirement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                status: 'error',
                message: 'Device not registered',
                details: { error: 'DeviceNotRegistered' },
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    await expect(
      deliverSavingsExpoPush({
        token: 'ExponentPushToken[hidden]',
        title: 'Title',
        body: 'Body',
        data: {
          type: 'savings',
          goalId: 'goal-1',
          notificationId: 'notification-1',
          merchantId: 'merchant-1',
        },
        channelId: 'savings',
      })
    ).resolves.toEqual({ outcome: 'unregistered', ticketId: null });
  });

  it('keeps malformed error tickets unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { status: 'error' } }), {
          status: 200,
        })
      )
    );

    await expect(
      deliverSavingsExpoPush({
        token: 'ExponentPushToken[hidden]',
        title: 'Title',
        body: 'Body',
        data: {
          type: 'savings',
          goalId: 'goal-1',
          notificationId: 'notification-1',
          merchantId: 'merchant-1',
        },
        channelId: 'savings',
      })
    ).resolves.toEqual({ outcome: 'unknown', ticketId: null });
  });

  it('accepts single-ticket objects and classifies documented whole-request errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { status: 'ok', id: 'ticket-object' } }),
          {
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [{ code: 'BAD_PAYLOAD', message: 'invalid' }],
          }),
          {
            status: 400,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [{ code: 'UPSTREAM', message: 'uncertain' }],
          }),
          {
            status: 503,
          }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const input = {
      token: 'ExponentPushToken[hidden]',
      title: 'Title',
      body: 'Body',
      data: {
        type: 'savings',
        goalId: 'goal-1',
        notificationId: 'notification-1',
        merchantId: 'merchant-1',
      } as const,
      channelId: 'savings' as const,
    };

    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'accepted',
      ticketId: 'ticket-object',
    });
    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'rejected',
      ticketId: null,
    });
    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'retryable',
      ticketId: null,
    });
  });

  it('keeps rate-limited deliveries retryable instead of rejecting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ code: 'RATE_LIMITED', message: 'slow down' }],
          }),
          { status: 429 }
        )
      )
    );
    const input = {
      token: 'ExponentPushToken[hidden]',
      title: 'Title',
      body: 'Body',
      data: {
        type: 'savings',
        goalId: 'goal-1',
        notificationId: 'notification-1',
        merchantId: 'merchant-1',
      } as const,
      channelId: 'savings' as const,
    };

    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'retryable',
      ticketId: null,
    });
  });

  it.each([
    429, 503,
  ])('stays retryable when a %s response has an empty body', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status }))
    );
    const input = {
      token: 'ExponentPushToken[hidden]',
      title: 'Title',
      body: 'Body',
      data: {
        type: 'savings',
        goalId: 'goal-1',
        notificationId: 'notification-1',
        merchantId: 'merchant-1',
      } as const,
      channelId: 'savings' as const,
    };

    await expect(deliverSavingsExpoPush(input)).resolves.toEqual({
      outcome: 'retryable',
      ticketId: null,
    });
  });
});
