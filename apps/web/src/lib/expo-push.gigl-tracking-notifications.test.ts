import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendPushNotificationsAsync = vi.fn();
const mockChunkPushNotifications = vi.fn((messages: unknown[]) => [messages]);

vi.mock('expo-server-sdk', () => {
  class MockExpo {
    sendPushNotificationsAsync = mockSendPushNotificationsAsync;
    chunkPushNotifications = mockChunkPushNotifications;

    static isExpoPushToken(token: unknown): boolean {
      return (
        typeof token === 'string' && token.startsWith('ExponentPushToken[')
      );
    }
  }

  return { default: MockExpo, Expo: MockExpo };
});

function createChainableMock(
  returnData: unknown = [],
  returnError: unknown = null
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const terminal = () =>
    Promise.resolve({ data: returnData, error: returnError });

  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
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

vi.mock('@/env', () => ({
  getExpoAccessToken: () => 'test-expo-token',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import type { ExpoPushMessage } from 'expo-server-sdk';
import { createAdminClient } from '@/lib/supabase/admin';

let sendPushNotifications: typeof import('./expo-push').sendPushNotifications;
let notifyMerchant: typeof import('./expo-push').notifyMerchant;
let notifyCustomer: typeof import('./expo-push').notifyCustomer;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('./expo-push');
  sendPushNotifications = mod.sendPushNotifications;
  notifyMerchant = mod.notifyMerchant;
  notifyCustomer = mod.notifyCustomer;
});

describe('GIGL tracking push delivery boundaries', () => {
  it('propagates a delivery-boundary failure before calling the provider', async () => {
    const messages: ExpoPushMessage[] = [
      { to: 'ExponentPushToken[a]', body: 'A' },
      { to: 'ExponentPushToken[b]', body: 'B' },
    ];
    const onDeliveryStart = vi
      .fn()
      .mockRejectedValue(new Error('lease unavailable'));

    await expect(
      sendPushNotifications(messages, { onDeliveryStart })
    ).rejects.toThrow('lease unavailable');

    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('marks delivery before mixed-project fallback sends', async () => {
    const msg1: ExpoPushMessage = { to: 'ExponentPushToken[a]', body: 'A' };
    const msg2: ExpoPushMessage = { to: 'ExponentPushToken[b]', body: 'B' };
    const onDeliveryStart = vi.fn();

    mockChunkPushNotifications.mockReturnValueOnce([[msg1, msg2]]);
    mockSendPushNotificationsAsync
      .mockRejectedValueOnce(
        new Error('same request must be for the same project')
      )
      .mockResolvedValueOnce([{ status: 'ok', id: 't1' }])
      .mockResolvedValueOnce([{ status: 'ok', id: 't2' }]);

    const { tickets } = await sendPushNotifications([msg1, msg2], {
      onDeliveryStart,
    });

    expect(tickets).toEqual([
      { status: 'ok', id: 't1' },
      { status: 'ok', id: 't2' },
    ]);
    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(3);
    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(2, [msg1]);
    expect(mockSendPushNotificationsAsync).toHaveBeenNthCalledWith(3, [msg2]);
    expect(onDeliveryStart).toHaveBeenCalledOnce();
  });

  it('signals delivery start before an accepted provider request', async () => {
    const chain = createChainableMock([{ token: 'ExponentPushToken[c1]' }]);
    const onDeliveryStart = vi.fn();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as never);
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-c1' },
    ]);

    await notifyCustomer('user-456', 'Test', 'Body', undefined, 'payments', {
      onDeliveryStart,
    });

    expect(onDeliveryStart).toHaveBeenCalledOnce();
    expect(onDeliveryStart).toHaveBeenCalledBefore(
      mockSendPushNotificationsAsync
    );
  });

  it('clears the delivery boundary after an explicit provider rejection', async () => {
    const chain = createChainableMock([{ token: 'ExponentPushToken[c1]' }]);
    const onDeliveryStart = vi.fn();
    const onDeliveryRejected = vi.fn();

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as never);
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      {
        status: 'error',
        message: 'Invalid credentials',
        details: { error: 'InvalidCredentials' },
      },
    ]);

    const result = await notifyCustomer(
      'user-456',
      'Test',
      'Body',
      undefined,
      'payments',
      { onDeliveryStart, onDeliveryRejected }
    );

    expect(onDeliveryStart).toHaveBeenCalledBefore(
      mockSendPushNotificationsAsync
    );
    expect(onDeliveryRejected).toHaveBeenCalledAfter(
      mockSendPushNotificationsAsync
    );
    expect(onDeliveryRejected).toHaveBeenCalledOnce();
    expect(result).toEqual({
      sent: 0,
      failed: 1,
      errors: ['InvalidCredentials (1 failed): Invalid credentials'],
    });
  });
});

describe('GIGL tracking notification capability filters', () => {
  it('filters merchant shipment updates to capable admin builds', async () => {
    const chain = createChainableMock([
      { token: 'ExponentPushToken[capable]' },
    ]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as never);
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-capable' },
    ]);

    await notifyMerchant(
      'merchant-123',
      'Shipment update',
      'Your shipment changed.',
      { type: 'shipment_tracking' },
      'orders',
      { requiredShipmentUpdateCapability: 1 }
    );

    expect(chain.gte).toHaveBeenCalledWith('shipment_update_capability', 1);
  });

  it('filters customer shipment updates to capable storefront builds', async () => {
    const chain = createChainableMock([
      { token: 'ExponentPushToken[c-capable]' },
    ]);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as never);
    mockSendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'ticket-c-capable' },
    ]);

    await notifyCustomer(
      'user-456',
      'Shipment update',
      'Your shipment changed.',
      { type: 'shipment_tracking' },
      'orders',
      {
        merchantId: 'merchant-123',
        requiredShipmentUpdateCapability: 1,
      }
    );

    expect(chain.gte).toHaveBeenCalledWith('shipment_update_capability', 1);
  });
});
