import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  processTickets: vi.fn(),
  recordPushAttempt: vi.fn(),
  sendPushNotifications: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('./expo-push', () => ({
  processTickets: (...args: unknown[]) => mocks.processTickets(...args),
  recordPushAttempt: (...args: unknown[]) => mocks.recordPushAttempt(...args),
  sendPushNotifications: (...args: unknown[]) =>
    mocks.sendPushNotifications(...args),
}));

function createChainableMock(
  returnData: unknown = [],
  returnError: unknown = null
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const terminal = () =>
    Promise.resolve({ data: returnData, error: returnError });

  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  Object.defineProperty(chain, 'then', {
    value: (
      resolve: (value: unknown) => unknown,
      reject?: (error: unknown) => unknown
    ) => terminal().then(resolve, reject),
    writable: true,
    configurable: true,
  });

  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordPushAttempt.mockResolvedValue(undefined);
  mocks.processTickets.mockResolvedValue({ sent: 1, failed: 0, errors: [] });
});

describe('notifyStorefrontUpdateAvailable', () => {
  it('records a skipped attempt when no update-eligible tokens match', async () => {
    const selectChain = createChainableMock([]);
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(selectChain),
    });

    const { notifyStorefrontUpdateAvailable } = await import(
      './mobile-update-nudge'
    );

    const result = await notifyStorefrontUpdateAvailable({
      platform: 'ios',
      latestBuild: 42,
    });

    expect(result).toMatchObject({ eligible: 0, sent: 0, failed: 0 });
    expect(selectChain.eq).toHaveBeenCalledWith('app_type', 'storefront');
    expect(mocks.sendPushNotifications).not.toHaveBeenCalled();
    expect(mocks.recordPushAttempt).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ tokenCount: 0 })
    );
  });

  it('records a failed attempt when sending update nudges throws', async () => {
    const selectChain = createChainableMock([
      { id: 'token-row-1', token: 'ExponentPushToken[1]' },
      { id: 'token-row-2', token: 'ExponentPushToken[2]' },
    ]);
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(selectChain),
    });
    mocks.sendPushNotifications.mockRejectedValueOnce(new Error('Expo down'));

    const { notifyStorefrontUpdateAvailable } = await import(
      './mobile-update-nudge'
    );

    const result = await notifyStorefrontUpdateAvailable({
      platform: 'android',
      latestBuild: 125,
    });

    expect(result).toMatchObject({
      platform: 'android',
      eligible: 2,
      sent: 0,
      failed: 2,
      errors: ['Expo down'],
      stampFailed: false,
    });
    expect(selectChain.update).not.toHaveBeenCalled();
    expect(selectChain.in).not.toHaveBeenCalledWith('id', expect.any(Array));
    expect(mocks.recordPushAttempt).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tokenCount: 2,
        result: expect.objectContaining({ failed: 2 }),
      })
    );
  });

  it('sends update nudges and stamps successfully nudged token ids', async () => {
    const selectChain = createChainableMock([
      { id: 'token-row-1', token: 'ExponentPushToken[1]' },
    ]);
    const stampChain = createChainableMock();
    const from = vi
      .fn()
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(stampChain);
    mocks.createAdminClient.mockReturnValue({ from });
    mocks.sendPushNotifications.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-1' },
    ]);

    const { notifyStorefrontUpdateAvailable } = await import(
      './mobile-update-nudge'
    );

    const result = await notifyStorefrontUpdateAvailable({
      appType: 'admin',
      platform: 'android',
      latestBuild: 125,
      now: new Date('2026-06-28T12:00:00.000Z'),
    });

    expect(result).toMatchObject({ eligible: 1, sent: 1, failed: 0 });
    expect(selectChain.eq).toHaveBeenCalledWith('app_type', 'admin');
    expect(mocks.sendPushNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        to: 'ExponentPushToken[1]',
        data: expect.objectContaining({
          type: 'mobile_update_available',
          platform: 'android',
        }),
      }),
    ]);
    expect(stampChain.update).toHaveBeenCalledWith({
      last_update_push_at: '2026-06-28T12:00:00.000Z',
    });
    expect(stampChain.in).toHaveBeenCalledWith('id', ['token-row-1']);
    expect(mocks.recordPushAttempt).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ appType: 'admin', tokenCount: 1 })
    );
    const sentMessages = mocks.sendPushNotifications.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    }[];
    const recordedAttempt = mocks.recordPushAttempt.mock.calls.at(-1)?.[1] as {
      payload: Record<string, unknown>;
    };
    expect(sentMessages[0]?.data.notification_id).toEqual(expect.any(String));
    expect(recordedAttempt.payload.notification_id).toBe(
      sentMessages[0]?.data.notification_id
    );
  });
});
