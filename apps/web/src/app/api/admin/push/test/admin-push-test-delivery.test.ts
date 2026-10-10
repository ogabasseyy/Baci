import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  expo: vi.fn(),
  sendChunks: vi.fn(),
}));

vi.mock('expo-server-sdk', () => ({
  default: class MockExpo {
    static isExpoPushToken(token: unknown): boolean {
      return (
        typeof token === 'string' &&
        (/^ExponentPushToken\[.+\]$/.test(token) ||
          /^ExpoPushToken\[.+\]$/.test(token))
      );
    }

    constructor(options: unknown) {
      mocks.expo(options);
    }
  },
}));

vi.mock('@/lib/expo-push-chunk-delivery', () => ({
  sendPushNotificationChunks: mocks.sendChunks,
}));

import { deliverAdminPushTest } from './admin-push-test-delivery';

const initialExpoAccessToken = process.env.EXPO_ACCESS_TOKEN;

function mockTokenQuery(result: {
  data: Array<{ token: string }> | null;
  error: unknown;
}) {
  const query = { eq: vi.fn() };
  query.eq
    .mockReturnValueOnce(query)
    .mockReturnValueOnce(query)
    .mockResolvedValueOnce(result);
  mocks.from.mockReturnValue({ select: vi.fn(() => query) });
  return query;
}

describe('deliverAdminPushTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXPO_ACCESS_TOKEN = 'expo-access-token';
  });

  afterEach(() => {
    if (initialExpoAccessToken === undefined) {
      delete process.env.EXPO_ACCESS_TOKEN;
      return;
    }
    process.env.EXPO_ACCESS_TOKEN = initialExpoAccessToken;
  });

  it('uses the authenticated RLS client to read only the current user admin tokens', async () => {
    const query = mockTokenQuery({
      data: [{ token: 'ExponentPushToken[one]' }],
      error: null,
    });
    mocks.sendChunks.mockResolvedValue({
      deliveryUncertain: false,
      tickets: [{ status: 'ok' }],
    });
    const supabase = { from: mocks.from };

    const result = await deliverAdminPushTest(
      supabase as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    expect(result).toEqual({ failed: 0, sent: 1, uncertain: 0 });
    expect(mocks.from).toHaveBeenCalledWith('push_tokens');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'is_active', true);
    expect(query.eq).toHaveBeenNthCalledWith(3, 'app_type', 'admin');
    expect(mocks.sendChunks).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({
          channelId: 'admin',
          data: { source: 'admin_push_test', type: 'admin_push_test' },
          to: 'ExponentPushToken[one]',
        }),
      ],
      { onDeliveryStart: expect.any(Function) }
    );
    expect(mocks.expo).toHaveBeenCalledWith({
      accessToken: 'expo-access-token',
    });
  });

  it('does not import the service-role environment module into the admin route graph', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/app/api/admin/push/test/admin-push-test-delivery.ts'
      ),
      'utf8'
    );

    expect(source).not.toContain("from '@/env'");
  });

  it('does not attempt delivery when the RLS query has no active admin token', async () => {
    mockTokenQuery({ data: [], error: null });

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    expect(result).toEqual({ failed: 0, sent: 0, uncertain: 0 });
    expect(mocks.sendChunks).not.toHaveBeenCalled();
  });

  it('reports uncertain delivery instead of definitive failure', async () => {
    mockTokenQuery({
      data: [{ token: 'ExponentPushToken[one]' }],
      error: null,
    });
    mocks.sendChunks.mockResolvedValue({
      deliveryUncertain: true,
      syntheticTicketIndexes: new Set([0]),
      tickets: [{ details: { error: 'ExpoError' }, status: 'error' }],
    });

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    expect(result).toEqual({ failed: 0, sent: 0, uncertain: 1 });
  });

  it('keeps definitive token failures out of uncertain counts', async () => {
    mockTokenQuery({
      data: [{ token: 'bad-token' }, { token: 'ExponentPushToken[one]' }],
      error: null,
    });
    mocks.sendChunks.mockResolvedValue({
      deliveryUncertain: true,
      syntheticTicketIndexes: new Set([1]),
      tickets: [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'ExpoError' } },
      ],
    });

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    expect(result).toEqual({ failed: 1, sent: 0, uncertain: 1 });
  });

  it('keeps unknown codes and missing details as failures under batch uncertainty', async () => {
    mockTokenQuery({
      data: [
        { token: 'ExponentPushToken[one]' },
        { token: 'ExponentPushToken[two]' },
        { token: 'ExponentPushToken[three]' },
      ],
      error: null,
    });
    mocks.sendChunks.mockResolvedValue({
      deliveryUncertain: true,
      syntheticTicketIndexes: new Set([2]),
      tickets: [
        { status: 'error', details: { error: 'FutureExpoCode' } },
        { status: 'error' },
        { status: 'error', details: { error: 'ExpoError' } },
      ],
    });

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    // Only producer-marked synthetic tickets convert: anything else is
    // a real ticket the batch-level flag must not excuse.
    expect(result).toEqual({ failed: 2, sent: 0, uncertain: 1 });
  });

  it("keeps Expo's own definitive ExpoError ticket out of uncertain counts", async () => {
    mockTokenQuery({
      data: [
        { token: 'ExponentPushToken[one]' },
        { token: 'ExponentPushToken[two]' },
      ],
      error: null,
    });
    mocks.sendChunks.mockResolvedValue({
      deliveryUncertain: true,
      syntheticTicketIndexes: new Set([1]),
      tickets: [
        { status: 'error', details: { error: 'ExpoError' } },
        { status: 'error', details: { error: 'ExpoError' } },
      ],
    });

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    // Same public code on both tickets: index 0 is Expo's definitive
    // rejection and stays failed; only the synthetic index converts.
    expect(result).toEqual({ failed: 1, sent: 0, uncertain: 1 });
  });

  it('reports a post-dispatch throw as uncertain', async () => {
    mockTokenQuery({
      data: [{ token: 'ExponentPushToken[one]' }],
      error: null,
    });
    mocks.sendChunks.mockImplementation(async (_expo, _messages, options) => {
      await options?.onDeliveryStart?.();
      throw new Error('fallback failed after partial send');
    });

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    expect(result).toEqual({ failed: 0, sent: 0, uncertain: 1 });
  });

  it('keeps never-dispatched invalid tokens out of post-dispatch uncertain counts', async () => {
    mockTokenQuery({
      data: [{ token: 'bad-token' }, { token: 'ExponentPushToken[one]' }],
      error: null,
    });
    mocks.sendChunks.mockImplementation(async (_expo, _messages, options) => {
      await options?.onDeliveryStart?.();
      throw new Error('fallback failed after partial send');
    });

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    // The invalid token never dispatched, so it is a definitive
    // failure even though dispatch started for the eligible token.
    expect(result).toEqual({ failed: 1, sent: 0, uncertain: 1 });
  });

  it('reports a pre-dispatch throw as a definitive failure', async () => {
    mockTokenQuery({
      data: [{ token: 'ExponentPushToken[one]' }],
      error: null,
    });
    mocks.sendChunks.mockRejectedValue(new Error('chunking failed'));

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    expect(result).toEqual({ failed: 1, sent: 0, uncertain: 0 });
  });

  it('reports provider failure only as a count', async () => {
    mockTokenQuery({
      data: [{ token: 'ExponentPushToken[one]' }],
      error: null,
    });
    mocks.sendChunks.mockRejectedValue(
      new Error('provider message must not leak')
    );

    const result = await deliverAdminPushTest(
      { from: mocks.from } as never,
      'user-1',
      'Push test',
      'Delivery check'
    );

    expect(result).toEqual({ failed: 1, sent: 0, uncertain: 0 });
  });
});
