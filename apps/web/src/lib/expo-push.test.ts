import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock expo-server-sdk
const mockSendPushNotificationsAsync = vi.fn();
const mockChunkPushNotifications = vi.fn((msgs: unknown[]) => [msgs]);
const mockChunkPushNotificationReceiptIds = vi.fn((ids: string[]) => [ids]);
const mockGetPushNotificationReceiptsAsync = vi.fn();

vi.mock('expo-server-sdk', () => {
  // Use a class so `new MockExpo()` survives vi.clearAllMocks()
  class MockExpo {
    sendPushNotificationsAsync = mockSendPushNotificationsAsync;
    chunkPushNotifications = mockChunkPushNotifications;
    chunkPushNotificationReceiptIds = mockChunkPushNotificationReceiptIds;
    getPushNotificationReceiptsAsync = mockGetPushNotificationReceiptsAsync;

    static isExpoPushToken(token: unknown): boolean {
      return (
        typeof token === 'string' && token.startsWith('ExponentPushToken[')
      );
    }
  }
  return { default: MockExpo, Expo: MockExpo };
});

// Mock Supabase admin client
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
  chain.insert = vi.fn().mockReturnValue(chain);
  // Supabase query builder returns thenables — Object.defineProperty avoids biome noThenProperty
  Object.defineProperty(chain, 'then', {
    value: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown
    ) => terminal().then(resolve, reject),
    writable: true,
    configurable: true,
  });

  return chain;
}

vi.mock('@/env', () => ({
  getExpoAccessToken: () => 'test-expo-token',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import type { ExpoPushMessage } from 'expo-server-sdk';
import { createAdminClient } from '@/lib/supabase/admin';

// We'll import functions after mocks are set up
let sendPushNotification: typeof import('./expo-push').sendPushNotification;
let sendPushNotifications: typeof import('./expo-push').sendPushNotifications;
let notifyMerchant: typeof import('./expo-push').notifyMerchant;
let notifyCustomer: typeof import('./expo-push').notifyCustomer;
let notifyAdminUserDevices: typeof import('./expo-push').notifyAdminUserDevices;
let notifyNewOrder: typeof import('./expo-push').notifyNewOrder;
let notifyPaymentReceived: typeof import('./expo-push').notifyPaymentReceived;
let notifyLowStock: typeof import('./expo-push').notifyLowStock;
let notifyNewReview: typeof import('./expo-push').notifyNewReview;
let notifyStorefrontUpdateAvailable: typeof import('./mobile-update-nudge').notifyStorefrontUpdateAvailable;
beforeEach(async () => {
  vi.clearAllMocks();

  const mod = await import('./expo-push');
  sendPushNotification = mod.sendPushNotification;
  sendPushNotifications = mod.sendPushNotifications;
  notifyMerchant = mod.notifyMerchant;
  notifyCustomer = mod.notifyCustomer;
  notifyAdminUserDevices = mod.notifyAdminUserDevices;
  notifyNewOrder = mod.notifyNewOrder;
  notifyPaymentReceived = mod.notifyPaymentReceived;
  notifyLowStock = mod.notifyLowStock;
  notifyNewReview = mod.notifyNewReview;
  notifyStorefrontUpdateAvailable = (await import('./mobile-update-nudge'))
    .notifyStorefrontUpdateAvailable;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// sendPushNotifications — SDK integration
// ---------------------------------------------------------------------------
describe('sendPushNotifications', () => {
  it('validates tokens with Expo.isExpoPushToken and skips invalid ones', async () => {
    const messages: ExpoPushMessage[] = [
      { to: 'ExponentPushToken[valid1]', body: 'Hello' },
      { to: 'invalid-token', body: 'Hello' },
      { to: 'ExponentPushToken[valid2]', body: 'World' },
    ];

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-1' },
      { status: 'ok', id: 'ticket-2' },
    ]);

    const tickets = await sendPushNotifications(messages);

    // Only valid tokens should be sent
    expect(mockChunkPushNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ to: 'ExponentPushToken[valid1]' }),
      expect.objectContaining({ to: 'ExponentPushToken[valid2]' }),
    ]);

    // Invalid token should get an error ticket
    expect(tickets).toHaveLength(3);
    expect(tickets[1].status).toBe('error');
  });

  it('chunks messages and sends via SDK', async () => {
    const messages: ExpoPushMessage[] = [
      { to: 'ExponentPushToken[a]', body: 'Test' },
    ];

    mockChunkPushNotifications.mockReturnValueOnce([messages]);
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-abc' },
    ]);

    const tickets = await sendPushNotifications(messages);

    expect(mockChunkPushNotifications).toHaveBeenCalled();
    expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith(messages);
    expect(tickets[0]).toEqual({ status: 'ok', id: 'ticket-abc' });
  });

  it('handles multiple chunks', async () => {
    const msg1: ExpoPushMessage = { to: 'ExponentPushToken[a]', body: 'A' };
    const msg2: ExpoPushMessage = { to: 'ExponentPushToken[b]', body: 'B' };

    mockChunkPushNotifications.mockReturnValueOnce([[msg1], [msg2]]);
    mockSendPushNotificationsAsync
      .mockResolvedValueOnce([{ status: 'ok', id: 't1' }])
      .mockResolvedValueOnce([{ status: 'ok', id: 't2' }]);

    const tickets = await sendPushNotifications([msg1, msg2]);

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(2);
    expect(tickets).toEqual([
      { status: 'ok', id: 't1' },
      { status: 'ok', id: 't2' },
    ]);
  });

  it('returns error tickets on SDK exception', async () => {
    const messages: ExpoPushMessage[] = [
      { to: 'ExponentPushToken[a]', body: 'Test' },
    ];

    mockChunkPushNotifications.mockReturnValueOnce([messages]);
    mockSendPushNotificationsAsync.mockRejectedValueOnce(
      new Error('Network failure')
    );

    const tickets = await sendPushNotifications(messages);

    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe('error');
    expect(tickets[0]).toHaveProperty('message', 'Network failure');
  });

  it('falls back to per-message sends when Expo rejects a mixed-project chunk', async () => {
    const msg1: ExpoPushMessage = { to: 'ExponentPushToken[a]', body: 'A' };
    const msg2: ExpoPushMessage = { to: 'ExponentPushToken[b]', body: 'B' };

    mockChunkPushNotifications.mockReturnValueOnce([[msg1, msg2]]);
    mockSendPushNotificationsAsync
      .mockRejectedValueOnce(
        new Error(
          'All push notification messages in the same request must be for the same project'
        )
      )
      .mockResolvedValueOnce([{ status: 'ok', id: 'ticket-a' }])
      .mockResolvedValueOnce([{ status: 'ok', id: 'ticket-b' }]);

    const tickets = await sendPushNotifications([msg1, msg2]);

    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(1, [
      msg1,
      msg2,
    ]);
    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(2, [msg1]);
    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(3, [msg2]);
    expect(tickets).toEqual([
      { status: 'ok', id: 'ticket-a' },
      { status: 'ok', id: 'ticket-b' },
    ]);
  });

  it('returns a synthesized error ticket when a per-message fallback send fails', async () => {
    const msg1: ExpoPushMessage = { to: 'ExponentPushToken[a]', body: 'A' };
    const msg2: ExpoPushMessage = { to: 'ExponentPushToken[b]', body: 'B' };

    mockChunkPushNotifications.mockReturnValueOnce([[msg1, msg2]]);
    mockSendPushNotificationsAsync
      .mockRejectedValueOnce(
        new Error(
          'All push notification messages in the same request must be for the same project'
        )
      )
      .mockResolvedValueOnce([{ status: 'ok', id: 'ticket-a' }])
      .mockRejectedValueOnce(new Error('Per-message send failed'));

    const tickets = await sendPushNotifications([msg1, msg2]);

    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(1, [
      msg1,
      msg2,
    ]);
    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(2, [msg1]);
    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(3, [msg2]);
    expect(tickets).toEqual([
      { status: 'ok', id: 'ticket-a' },
      {
        status: 'error',
        message: 'Per-message send failed',
        details: { error: 'ExpoError' },
      },
    ]);
  });

  it('returns empty array for empty messages', async () => {
    const tickets = await sendPushNotifications([]);
    expect(tickets).toEqual([]);
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendPushNotification — single token
// ---------------------------------------------------------------------------
describe('sendPushNotification', () => {
  it('sends a single notification with correct defaults', async () => {
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-1' },
    ]);

    const ticket = await sendPushNotification(
      'ExponentPushToken[abc]',
      'Title',
      'Body text'
    );

    expect(mockChunkPushNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        to: 'ExponentPushToken[abc]',
        title: 'Title',
        body: 'Body text',
        sound: 'default',
        channelId: 'general',
        priority: 'default',
      }),
    ]);
    expect(ticket.status).toBe('ok');
  });

  it('uses high priority for orders channel', async () => {
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-2' },
    ]);

    await sendPushNotification(
      'ExponentPushToken[abc]',
      'Order',
      'New order',
      undefined,
      'orders'
    );

    expect(mockChunkPushNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        priority: 'high',
        channelId: 'orders',
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// notifyMerchant — queries tokens with app_type='admin'
// ---------------------------------------------------------------------------
describe('notifyMerchant', () => {
  it('queries tokens filtered by merchant_id, is_active, and app_type=admin', async () => {
    const mockChain = createChainableMock([
      { token: 'ExponentPushToken[m1]' },
      { token: 'ExponentPushToken[m2]' },
    ]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-1' },
      { status: 'ok', id: 'ticket-2' },
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    // Verify the query chain
    expect(mockChain.select).toHaveBeenCalledWith('token, platform');
    expect(mockChain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-123');
    expect(mockChain.eq).toHaveBeenCalledWith('is_active', true);
    expect(mockChain.eq).toHaveBeenCalledWith('app_type', 'admin');

    expect(result).toEqual({
      sent: 2,
      failed: 0,
      errors: [],
      succeededTokens: ['ExponentPushToken[m1]', 'ExponentPushToken[m2]'],
    });
  });

  it('returns zeros when no tokens found', async () => {
    const mockChain = createChainableMock([]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');
    expect(result).toEqual({ sent: 0, failed: 0, errors: [] });
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('deactivates DeviceNotRegistered tokens', async () => {
    const updateChain = createChainableMock();
    const ticketInsertChain = createChainableMock();
    const attemptInsertChain = createChainableMock();
    const selectChain = createChainableMock([
      { token: 'ExponentPushToken[good]' },
      { token: 'ExponentPushToken[stale]' },
    ]);

    const mockFromFn = vi
      .fn()
      .mockReturnValueOnce(selectChain) // first call: select tokens
      .mockReturnValueOnce(updateChain) // second call: update to deactivate
      .mockReturnValueOnce(ticketInsertChain) // third call: store tickets
      .mockReturnValueOnce(attemptInsertChain); // fourth call: store attempt

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFromFn,
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-1' },
      {
        status: 'error',
        message: 'Device not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);

    // Should deactivate the stale token with an audited reason
    expect(updateChain.update).toHaveBeenCalledWith({
      is_active: false,
      deactivation_reason: 'DeviceNotRegistered',
      deactivated_at: expect.any(String),
    });
    expect(updateChain.in).toHaveBeenCalledWith('token', [
      'ExponentPushToken[stale]',
    ]);
  });

  it('deactivates an isolated InvalidCredentials token and aggregates the error by code', async () => {
    const updateChain = createChainableMock();
    const ticketInsertChain = createChainableMock();
    const attemptInsertChain = createChainableMock();
    // The failing token's platform group must be >= 10 with <= 10% failures
    const selectChain = createChainableMock([
      ...Array.from({ length: 9 }, (_, i) => ({
        token: `ExponentPushToken[good-${i}]`,
        platform: 'ios',
      })),
      { token: 'ExponentPushToken[wrong-project]', platform: 'ios' },
    ]);

    const mockFromFn = vi
      .fn()
      .mockReturnValueOnce(selectChain) // first call: select tokens
      .mockReturnValueOnce(updateChain) // second call: update to deactivate
      .mockReturnValueOnce(ticketInsertChain) // third call: store tickets
      .mockReturnValueOnce(attemptInsertChain); // fourth call: store attempt

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFromFn,
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      ...Array.from({ length: 9 }, (_, i) => ({
        status: 'ok' as const,
        id: `ticket-${i}`,
      })),
      {
        status: 'error',
        message:
          'Could not find APNs credentials for com.example.app (@owner/project). You may need to generate or upload new push credentials.',
        details: { error: 'InvalidCredentials' },
      },
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    expect(result.sent).toBe(9);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      expect.stringContaining(
        'InvalidCredentials (1 failed, 1 token(s) deactivated)'
      ),
    ]);

    expect(updateChain.update).toHaveBeenCalledWith({
      is_active: false,
      deactivation_reason: 'InvalidCredentials',
      deactivated_at: expect.any(String),
    });
    expect(updateChain.in).toHaveBeenCalledWith('token', [
      'ExponentPushToken[wrong-project]',
    ]);
  });

  it('omits the deactivation note when the deactivation update fails', async () => {
    const updateChain = createChainableMock(null, {
      message: 'update failed',
    });
    const attemptInsertChain = createChainableMock();
    const selectChain = createChainableMock([
      { token: 'ExponentPushToken[stale]' },
    ]);

    const mockFromFn = vi
      .fn()
      .mockReturnValueOnce(selectChain) // first call: select tokens
      .mockReturnValueOnce(updateChain) // second call: deactivation update (fails)
      .mockReturnValueOnce(attemptInsertChain); // third call: store attempt

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFromFn,
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      {
        status: 'error',
        message: 'Device not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    expect(result.failed).toBe(1);
    // The summary must not claim a deactivation that did not happen
    expect(result.errors).toEqual([
      'DeviceNotRegistered (1 failed): Device not registered',
    ]);
  });

  it('leaves tokens active when InvalidCredentials failures are widespread', async () => {
    const ticketInsertChain = createChainableMock();
    const attemptInsertChain = createChainableMock();
    const selectChain = createChainableMock(
      Array.from({ length: 10 }, (_, i) => ({
        token: `ExponentPushToken[ios-${i}]`,
        platform: 'ios',
      }))
    );

    const mockFromFn = vi
      .fn()
      .mockReturnValueOnce(selectChain) // first call: select tokens
      .mockReturnValueOnce(ticketInsertChain) // second call: store ok tickets (no deactivation update)
      .mockReturnValueOnce(attemptInsertChain); // third call: store attempt

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFromFn,
    } as never);

    // Half the batch failing = project-wide credential breakage, not dead tokens
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      ...Array.from({ length: 5 }, (_, i) => ({
        status: 'ok' as const,
        id: `ticket-${i}`,
      })),
      ...Array.from({ length: 5 }, () => ({
        status: 'error' as const,
        message: 'Could not find APNs credentials for com.example.app.',
        details: { error: 'InvalidCredentials' },
      })),
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    expect(result.sent).toBe(5);
    expect(result.failed).toBe(5);
    expect(result.errors).toEqual([
      'InvalidCredentials (5 failed): Could not find APNs credentials for com.example.app.',
    ]);
    // No push_tokens deactivation update — only the initial token select
    const pushTokenCalls = mockFromFn.mock.calls.filter(
      ([table]) => table === 'push_tokens'
    );
    expect(pushTokenCalls).toHaveLength(1);
  });

  it('scopes the InvalidCredentials ratio to the failing platform, not the whole batch', async () => {
    const ticketInsertChain = createChainableMock();
    const attemptInsertChain = createChainableMock();
    // 90 healthy Android tokens + 10 iOS tokens whose credentials broke:
    // 10% of the whole batch, but 100% of the iOS credential scope.
    const selectChain = createChainableMock([
      ...Array.from({ length: 90 }, (_, i) => ({
        token: `ExponentPushToken[android-${i}]`,
        platform: 'android',
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        token: `ExponentPushToken[ios-${i}]`,
        platform: 'ios',
      })),
    ]);

    const mockFromFn = vi
      .fn()
      .mockReturnValueOnce(selectChain) // first call: select tokens
      .mockReturnValueOnce(ticketInsertChain) // second call: store ok tickets (no deactivation update)
      .mockReturnValueOnce(attemptInsertChain); // third call: store attempt

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFromFn,
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      ...Array.from({ length: 90 }, (_, i) => ({
        status: 'ok' as const,
        id: `ticket-${i}`,
      })),
      ...Array.from({ length: 10 }, () => ({
        status: 'error' as const,
        message: 'Could not find APNs credentials for com.example.app.',
        details: { error: 'InvalidCredentials' },
      })),
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    expect(result.sent).toBe(90);
    expect(result.failed).toBe(10);
    // The iOS scope failed entirely — credentials issue, tokens stay active
    const pushTokenCalls = mockFromFn.mock.calls.filter(
      ([table]) => table === 'push_tokens'
    );
    expect(pushTokenCalls).toHaveLength(1);
    expect(result.errors).toEqual([
      'InvalidCredentials (10 failed): Could not find APNs credentials for com.example.app.',
    ]);
  });

  it('does not deactivate tokens for transient MessageRateExceeded errors', async () => {
    const ticketInsertChain = createChainableMock();
    const attemptInsertChain = createChainableMock();
    const selectChain = createChainableMock([
      { token: 'ExponentPushToken[busy]' },
    ]);

    const mockFromFn = vi
      .fn()
      .mockReturnValueOnce(selectChain) // first call: select tokens
      .mockReturnValueOnce(ticketInsertChain) // second call: store tickets (no deactivation update)
      .mockReturnValueOnce(attemptInsertChain); // third call: store attempt

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFromFn,
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      {
        status: 'error',
        message: 'Rate limit exceeded',
        details: { error: 'MessageRateExceeded' },
      },
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');

    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      'MessageRateExceeded (1 failed): Rate limit exceeded',
    ]);
    // No push_tokens update should happen — only ticket + attempt inserts
    const updateCalls = mockFromFn.mock.calls.filter(
      ([table]) => table === 'push_tokens'
    );
    expect(updateCalls).toHaveLength(1); // the initial token select only
  });

  it('handles DB error when fetching tokens', async () => {
    const mockChain = createChainableMock(null, {
      message: 'DB connection failed',
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body');
    expect(result).toEqual({
      sent: 0,
      failed: 0,
      errors: ['DB connection failed'],
    });
  });

  it('records a failed attempt when push sending throws before ticket processing', async () => {
    const selectChain = createChainableMock([
      { token: 'ExponentPushToken[m1]' },
      { token: 'ExponentPushToken[m2]' },
    ]);
    const attemptInsertChain = createChainableMock();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(attemptInsertChain),
    } as never);

    mockChunkPushNotifications.mockImplementationOnce(() => {
      throw new Error('Chunking failed');
    });

    const result = await notifyMerchant('merchant-123', 'Test', 'Body', {
      type: 'new_order',
    });

    expect(result).toEqual({
      sent: 0,
      failed: 2,
      errors: ['Chunking failed'],
    });
    expect(attemptInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'merchant-123',
        title: 'Test',
        body: 'Body',
        payload: { type: 'new_order' },
        token_count: 2,
        failed_count: 2,
        status: 'failed',
      })
    );
  });

  it('skips excluded tokens so retries never duplicate delivered alerts', async () => {
    const mockChain = createChainableMock([
      { token: 'ExponentPushToken[m1]' },
      { token: 'ExponentPushToken[m2]' },
    ]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-2' },
    ]);

    const result = await notifyMerchant(
      'merchant-123',
      'Test',
      'Body',
      {},
      'orders',
      {
        excludeTokens: ['ExponentPushToken[m1]'],
      }
    );

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
      expect.objectContaining({ to: 'ExponentPushToken[m2]' }),
    ]);
    expect(result).toEqual({
      sent: 1,
      failed: 0,
      errors: [],
      succeededTokens: ['ExponentPushToken[m2]'],
    });
  });

  it('persists delivered tokens on the attempt for per-token retries', async () => {
    const mockChain = createChainableMock([
      { token: 'ExponentPushToken[m1]' },
      { token: 'ExponentPushToken[m2]' },
    ]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-1' },
      {
        status: 'error',
        message: 'bad token',
        details: { error: 'UnknownError' },
      },
    ]);

    const result = await notifyMerchant('merchant-123', 'Test', 'Body', {
      type: 'new_order',
      jumia_order_id: 'order-1',
    });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'partial_failure',
        payload: {
          type: 'new_order',
          jumia_order_id: 'order-1',
          delivered_tokens: ['ExponentPushToken[m1]'],
        },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// notifyCustomer — queries tokens with app_type='storefront'
// ---------------------------------------------------------------------------
describe('notifyCustomer', () => {
  it('queries tokens filtered by user_id, is_active, and app_type=storefront', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[c1]' }]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-c1' },
    ]);

    const result = await notifyCustomer('user-456', 'Test', 'Body');

    expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'user-456');
    expect(mockChain.eq).toHaveBeenCalledWith('is_active', true);
    expect(mockChain.eq).toHaveBeenCalledWith('app_type', 'storefront');
    expect(mockChain.eq).not.toHaveBeenCalledWith(
      'merchant_id',
      expect.anything()
    );

    expect(result).toEqual({
      sent: 1,
      failed: 0,
      errors: [],
      succeededTokens: ['ExponentPushToken[c1]'],
    });
  });

  it('scopes token lookup to the merchant when options.merchantId is provided', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[c1]' }]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-c1' },
    ]);

    await notifyCustomer('user-456', 'Test', 'Body', undefined, 'payments', {
      merchantId: 'merchant-123',
    });

    // A wallet credit for merchant A must never push to devices registered
    // for merchant B's storefront.
    expect(mockChain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-123');
    expect(mockChain.insert).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({ merchant_id: 'merchant-123' }),
      ])
    );
    expect(mockChain.insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ merchant_id: 'merchant-123' })
    );
  });

  it('signals delivery start when an Expo request has an unknown outcome', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[c1]' }]);
    const onDeliveryStart = vi.fn();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);
    mockSendPushNotificationsAsync.mockRejectedValueOnce(
      new Error('network timeout')
    );

    await notifyCustomer('user-456', 'Test', 'Body', undefined, 'payments', {
      onDeliveryStart,
    });

    expect(onDeliveryStart).toHaveBeenCalledTimes(1);
  });

  it('does not signal delivery start when there are no eligible tokens', async () => {
    const mockChain = createChainableMock([]);
    const onDeliveryStart = vi.fn();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    await notifyCustomer('user-456', 'Test', 'Body', undefined, 'payments', {
      onDeliveryStart,
    });

    expect(onDeliveryStart).not.toHaveBeenCalled();
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('does not signal delivery start when every stored token is malformed', async () => {
    const mockChain = createChainableMock([{ token: 'not-an-expo-token' }]);
    const onDeliveryStart = vi.fn();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    const result = await notifyCustomer(
      'user-456',
      'Test',
      'Body',
      undefined,
      'payments',
      { onDeliveryStart }
    );

    expect(onDeliveryStart).not.toHaveBeenCalled();
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
  });
});

describe('notifyAdminUserDevices', () => {
  it('queries only the authenticated admin user devices', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[a1]' }]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-a1' },
    ]);

    const result = await notifyAdminUserDevices('user-123', 'Test', 'Body');

    expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    expect(mockChain.eq).toHaveBeenCalledWith('is_active', true);
    expect(mockChain.eq).toHaveBeenCalledWith('app_type', 'admin');
    expect(result).toEqual({
      sent: 1,
      failed: 0,
      errors: [],
      succeededTokens: ['ExponentPushToken[a1]'],
    });
  });

  it('returns zeroed result and skips send when no tokens are found', async () => {
    const mockChain = createChainableMock([]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    const result = await notifyAdminUserDevices('user-empty', 'Title', 'Body');

    expect(result).toEqual({ sent: 0, failed: 0, errors: [] });
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('returns errors when the database query fails', async () => {
    const mockChain = createChainableMock(null, {
      message: 'DB connection lost',
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    const result = await notifyAdminUserDevices('user-err', 'Title', 'Body');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('DB connection lost');
  });
});

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------
describe('notifyNewOrder', () => {
  it('sends order notification with formatted amount', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[m1]' }]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 't1' },
    ]);

    await notifyNewOrder('merchant-1', 'order-1', 'ORD001', 'John Doe', 15000);

    const sentMessages = mockChunkPushNotifications.mock
      .calls[0][0] as ExpoPushMessage[];
    expect(sentMessages[0].title).toContain('New Order');
    expect(sentMessages[0].body).toContain('ORD001');
    expect(sentMessages[0].body).toContain('John Doe');
    expect(sentMessages[0].channelId).toBe('orders');
    expect(sentMessages[0].data).toEqual(
      expect.objectContaining({
        type: 'new_order',
        order_id: 'order-1',
        order_number: 'ORD001',
      })
    );
  });
});

describe('notifyPaymentReceived', () => {
  it('includes order number in body when provided', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[m1]' }]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 't1' },
    ]);

    await notifyPaymentReceived('merchant-1', 5000, 'NGN', 'ORD002', 'order-2');

    const sentMessages = mockChunkPushNotifications.mock
      .calls[0][0] as ExpoPushMessage[];
    expect(sentMessages[0].body).toContain('ORD002');
    expect(sentMessages[0].channelId).toBe('payments');
    expect(sentMessages[0].data).toEqual(
      expect.objectContaining({
        type: 'payment_received',
        order_id: 'order-2',
        order_number: 'ORD002',
      })
    );
  });
});

describe('notifyLowStock', () => {
  it('includes product name and stock info', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[m1]' }]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 't1' },
    ]);

    await notifyLowStock('merchant-1', 'product-1', 'Red Sneakers', 3, 10);

    const sentMessages = mockChunkPushNotifications.mock
      .calls[0][0] as ExpoPushMessage[];
    expect(sentMessages[0].body).toContain('Red Sneakers');
    expect(sentMessages[0].body).toContain('3');
    expect(sentMessages[0].channelId).toBe('stock');
    expect(sentMessages[0].data).toEqual(
      expect.objectContaining({
        type: 'low_stock',
        product_id: 'product-1',
        product_name: 'Red Sneakers',
      })
    );
  });
});

describe('notifyNewReview', () => {
  it('includes reviewer name and rating', async () => {
    const mockChain = createChainableMock([{ token: 'ExponentPushToken[m1]' }]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 't1' },
    ]);

    await notifyNewReview('merchant-1', 'Blue Shirt', 5, 'Jane');

    const sentMessages = mockChunkPushNotifications.mock
      .calls[0][0] as ExpoPushMessage[];
    expect(sentMessages[0].body).toContain('Jane');
    expect(sentMessages[0].body).toContain('5');
    expect(sentMessages[0].body).toContain('Blue Shirt');
  });
});

describe('notifyStorefrontUpdateAvailable', () => {
  it('pushes mobile_update_available to eligible tokens and stamps the throttle', async () => {
    const selectChain = createChainableMock([
      { id: 'id1', token: 'ExponentPushToken[a]' },
      { id: 'id2', token: 'ExponentPushToken[b]' },
    ]);
    const ticketInsertChain = createChainableMock();
    const stampChain = createChainableMock();
    const attemptInsertChain = createChainableMock();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectChain) // select eligible tokens
        .mockReturnValueOnce(ticketInsertChain) // processTickets ticket insert
        .mockReturnValueOnce(stampChain) // stamp last_update_push_at
        .mockReturnValueOnce(attemptInsertChain), // record attempt
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 't1' },
      { status: 'ok', id: 't2' },
    ]);

    const result = await notifyStorefrontUpdateAvailable({
      platform: 'android',
      latestBuild: 646,
      storeUrl:
        'https://play.google.com/store/apps/details?id=com.ogabassey.store',
      now: new Date('2026-06-21T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      platform: 'android',
      eligible: 2,
      sent: 2,
      failed: 0,
      cappedAtLimit: false,
    });

    // Filters to active storefront tokens for the platform, below latest build.
    expect(selectChain.eq).toHaveBeenCalledWith('app_type', 'storefront');
    expect(selectChain.eq).toHaveBeenCalledWith('platform', 'android');
    expect(selectChain.eq).toHaveBeenCalledWith('is_active', true);
    // A SINGLE .or() carrying BOTH conditions AND-combined as an OR-of-ANDs.
    // Chaining two .or() calls would drop the build filter (PostgREST overwrite);
    // a flat OR of the four leaves would bypass the throttle. Asserting the
    // and(...) groups locks in the AND-combination, not just substring presence.
    expect(selectChain.or).toHaveBeenCalledTimes(1);
    const orArg = selectChain.or.mock.calls[0][0] as string;
    expect(orArg).toContain(
      'and(build_number.is.null,last_update_push_at.is.null)'
    );
    expect(orArg).toContain('and(build_number.lt.646,last_update_push_at.lt.');
    expect(orArg).toContain('and(build_number.is.null,last_update_push_at.lt.');
    expect(orArg).toContain(
      'and(build_number.lt.646,last_update_push_at.is.null)'
    );
    // No bare leaf outside an and() group (would mean the throttle is bypassed).
    expect(orArg).not.toMatch(/(^|,)build_number\.(is\.null|lt\.646)(,|$)/);
    // Never-nudged first, then oldest — so the backlog drains deterministically.
    expect(selectChain.order).toHaveBeenCalledWith('last_update_push_at', {
      ascending: true,
      nullsFirst: true,
    });

    // Sends the payload the app's tap handler routes to the update prompt.
    const sent = mockChunkPushNotifications.mock
      .calls[0][0] as ExpoPushMessage[];
    expect(sent[0].data).toMatchObject({
      type: 'mobile_update_available',
      platform: 'android',
    });
    expect(sent[0].title).toBe('Update available');

    // Throttle-stamps only the devices that actually received the nudge.
    expect(stampChain.update).toHaveBeenCalledWith({
      last_update_push_at: '2026-06-21T00:00:00.000Z',
    });
    expect(stampChain.in).toHaveBeenCalledWith('id', ['id1', 'id2']);
  });

  it('sends nothing and reports zero eligible when no tokens match', async () => {
    const selectChain = createChainableMock([]);
    const attemptInsertChain = createChainableMock();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(attemptInsertChain),
    } as never);

    const result = await notifyStorefrontUpdateAvailable({
      platform: 'ios',
      latestBuild: 390,
    });

    expect(result).toMatchObject({ platform: 'ios', eligible: 0, sent: 0 });
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('chunks the throttle stamp so the .in() filter stays within URL limits', async () => {
    const tokens = Array.from({ length: 150 }, (_, i) => ({
      id: `id${i}`,
      token: `ExponentPushToken[t${i}]`,
    }));
    const chain = createChainableMock(tokens);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as never);
    mockSendPushNotificationsAsync.mockResolvedValueOnce(
      tokens.map((_, i) => ({ status: 'ok', id: `ticket-${i}` }))
    );

    const result = await notifyStorefrontUpdateAvailable({
      platform: 'android',
      latestBuild: 646,
      limit: 150,
    });

    // 150 stamped ids → 2 chunks (100 + 50); no chunk exceeds the 100 cap, so
    // the PATCH .in() URL can never grow unbounded.
    const idStampCalls = chain.in.mock.calls.filter((call) => call[0] === 'id');
    expect(idStampCalls).toHaveLength(2);
    expect(idStampCalls[0][1]).toHaveLength(100);
    expect(idStampCalls[1][1]).toHaveLength(50);
    // Hit the per-run limit → backlog signal is set for operators.
    expect(result.cappedAtLimit).toBe(true);
  });

  it('flags stampFailed when the throttle write fails after a successful send', async () => {
    const selectChain = createChainableMock([
      { id: 'id1', token: 'ExponentPushToken[a]' },
    ]);
    const ticketInsertChain = createChainableMock();
    // The last_update_push_at update errors.
    const stampChain = createChainableMock(null, { message: 'db write down' });
    const attemptInsertChain = createChainableMock();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectChain) // select eligible tokens
        .mockReturnValueOnce(ticketInsertChain) // processTickets ticket insert
        .mockReturnValueOnce(stampChain) // stamp (fails)
        .mockReturnValueOnce(attemptInsertChain), // record attempt
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 't1' },
    ]);

    const result = await notifyStorefrontUpdateAvailable({
      platform: 'android',
      latestBuild: 646,
    });

    // Delivered, but throttle not written → caller must alert/retry.
    expect(result.sent).toBe(1);
    expect(result.stampFailed).toBe(true);
  });

  it('filters by app_type admin when appType is admin', async () => {
    const selectChain = createChainableMock([
      { id: 'id1', token: 'ExponentPushToken[a]' },
    ]);
    const ticketInsertChain = createChainableMock();
    const stampChain = createChainableMock();
    const attemptInsertChain = createChainableMock();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(ticketInsertChain)
        .mockReturnValueOnce(stampChain)
        .mockReturnValueOnce(attemptInsertChain),
    } as never);

    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 't1' },
    ]);

    const result = await notifyStorefrontUpdateAvailable({
      appType: 'admin',
      platform: 'ios',
      latestBuild: 22,
    });

    expect(selectChain.eq).toHaveBeenCalledWith('app_type', 'admin');
    expect(result).toMatchObject({ platform: 'ios', sent: 1 });
  });
});
