// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const zeptoMailRequest = vi.hoisted(() => vi.fn());
const resetTransportDispatchForFallback = vi.hoisted(() => vi.fn());
vi.mock('@/lib/zeptomail-transport', () => ({
  ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE: 'DELIVERY_OUTCOME_UNKNOWN',
  zeptoMailRequest,
}));
vi.mock('@/lib/zeptomail-dispatch-reset', () => ({
  resetTransportDispatchForFallback,
}));

import {
  isRetryableError,
  parseError,
  runZeptoMailTransport,
  type ZeptoMailTransportRun,
} from './zeptomail-retry';

function runWith(
  overrides: Partial<ZeptoMailTransportRun> = {}
): ZeptoMailTransportRun {
  return {
    sender: {
      address: 'orders@shop.com',
      name: 'Shop',
      isCustomDomain: false,
    },
    content: {
      recipientEmail: 'ada@example.com',
      subject: 'Receipt',
      htmlContent: '<p>hi</p>',
    },
    resolvePlatformSender: () => ({
      address: 'noreply@usebaci.com',
      name: 'Baci',
    }),
    resolveToken: () => 'token-1',
    onAccepted: async () => {},
    ...overrides,
  };
}

describe('zeptomail-retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    resetTransportDispatchForFallback.mockResolvedValue(true);
  });

  it('parses provider, Error, and unknown failures', () => {
    expect(
      parseError({
        error: { code: 'TM_1001', message: 'bad', details: { a: 1 } },
      })
    ).toEqual({ message: 'bad', code: 'TM_1001', details: { a: 1 } });
    const coded = new Error('nope') as Error & { code: string };
    coded.code = 'E_CONN';
    expect(parseError(coded)).toEqual({ message: 'nope', code: 'E_CONN' });
    expect(parseError('flat')).toEqual({ message: 'flat' });
  });

  it('retries only server-side error codes', () => {
    expect(isRetryableError('TM_5002')).toBe(true);
    expect(isRetryableError('TM_5999')).toBe(true);
    expect(isRetryableError('TM_1001')).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('returns success on the first accepted attempt', async () => {
    zeptoMailRequest.mockResolvedValue({ request_id: 'req-1' });
    const onAccepted = vi.fn(async () => {});
    const outcome = await runZeptoMailTransport(runWith({ onAccepted }));
    expect(outcome).toEqual({ ok: { success: true, messageId: 'req-1' } });
    expect(zeptoMailRequest).toHaveBeenCalledTimes(1);
    expect(zeptoMailRequest.mock.calls[0][2]).toBe('token-1');
    expect(onAccepted).toHaveBeenCalledWith({
      senderAddress: 'orders@shop.com',
      attemptCount: 1,
      messageId: 'req-1',
    });
  });

  it('retries retryable errors then reports the definite failure', async () => {
    vi.useFakeTimers();
    zeptoMailRequest.mockRejectedValue({
      error: { code: 'TM_5001', message: 'down' },
    });
    const pending = runZeptoMailTransport(runWith());
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expect(zeptoMailRequest).toHaveBeenCalledTimes(4);
    expect(outcome).toMatchObject({
      failed: { code: 'TM_5001' },
      attempts: 4,
      finalSenderAddress: 'orders@shop.com',
      deliveryOutcomeUnknown: false,
    });
  });

  it('fails over to the platform sender once for custom domains', async () => {
    zeptoMailRequest
      .mockRejectedValueOnce({
        error: { code: 'TM_1001', message: 'sender rejected' },
      })
      .mockResolvedValueOnce({ request_id: 'req-fallback' });
    const outcome = await runZeptoMailTransport(
      runWith({
        sender: {
          address: 'orders@custom.com',
          name: 'Shop',
          isCustomDomain: true,
        },
      })
    );
    expect(outcome).toEqual({
      ok: { success: true, messageId: 'req-fallback' },
    });
    expect(resetTransportDispatchForFallback).toHaveBeenCalledTimes(1);
    expect(zeptoMailRequest.mock.calls[1][1].from.address).toBe(
      'noreply@usebaci.com'
    );
  });

  it('reports a missing token as a failure instead of throwing', async () => {
    zeptoMailRequest.mockResolvedValue({ request_id: 'req-1' });
    const outcome = await runZeptoMailTransport(
      runWith({
        resolveToken: () => {
          throw new Error(
            'ZEPTOMAIL_TOKEN environment variable is not configured'
          );
        },
      })
    );
    expect(zeptoMailRequest).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      failed: {
        message: 'ZEPTOMAIL_TOKEN environment variable is not configured',
      },
      deliveryOutcomeUnknown: false,
    });
  });
});
