import { describe, expect, it, vi } from 'vitest';
import { createGiglNotificationPushStore } from './gigl-notification-push-store';

const lease = { notificationId: 'n-1', workerId: 'w-1' };

function client(response: {
  data?: unknown;
  error?: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: response.data ?? null,
    error: response.error ?? null,
  });
  return { rpc };
}

describe('createGiglNotificationPushStore', () => {
  it('fetches merchant tokens through the lease-bound wrapper', async () => {
    const c = client({ data: [{ token: 't', platform: 'ios' }] });
    const store = createGiglNotificationPushStore(c, lease);

    const result = await store.fetchMerchantTokens({
      merchantId: 'ignored',
      recipientUserIds: ['u1'],
      requiredCapability: 1,
    });

    expect(result).toEqual({
      data: [{ token: 't', platform: 'ios' }],
      error: null,
    });
    expect(c.rpc).toHaveBeenCalledWith('gigl_worker_notification_push_tokens', {
      p_id: 'n-1',
      p_recipient_user_ids: ['u1'],
      p_required_capability: 1,
      p_worker_id: 'w-1',
    });
  });

  it('never forwards the caller-supplied customer or merchant id', async () => {
    const c = client({ data: [] });
    const store = createGiglNotificationPushStore(c, lease);

    await store.fetchCustomerTokens({
      userId: 'someone-else',
      merchantId: 'other-merchant',
      requiredCapability: 1,
    });

    expect(JSON.stringify(c.rpc.mock.calls)).not.toContain('someone-else');
    expect(JSON.stringify(c.rpc.mock.calls)).not.toContain('other-merchant');
  });

  it('surfaces token read errors as a store error', async () => {
    const store = createGiglNotificationPushStore(
      client({ error: { message: 'boom' } }),
      lease
    );

    await expect(store.fetchCustomerTokens({ userId: 'u' })).resolves.toEqual({
      data: null,
      error: { message: 'boom' },
    });
  });

  it('stores tickets with only the fields the wrapper accepts', async () => {
    const c = client({ data: 1 });
    const store = createGiglNotificationPushStore(c, lease);

    await store.insertTickets([
      {
        app_type: 'admin',
        channel: 'orders',
        merchant_id: 'm',
        notification_type: 'shipment_tracking',
        push_token: 'tok',
        status: 'pending',
        ticket_id: 'tk',
        user_id: null,
      },
    ]);

    expect(c.rpc).toHaveBeenCalledWith(
      'gigl_worker_store_notification_push_tickets',
      {
        p_id: 'n-1',
        p_tickets: [
          {
            channel: 'orders',
            notification_type: 'shipment_tracking',
            push_token: 'tok',
            ticket_id: 'tk',
          },
        ],
        p_worker_id: 'w-1',
      }
    );
  });

  it('deactivates tokens and records attempts through their wrappers', async () => {
    const c = client({ data: 1 });
    const store = createGiglNotificationPushStore(c, lease);

    await expect(
      store.deactivateTokens('DeviceNotRegistered', ['a'])
    ).resolves.toEqual({
      error: null,
    });
    await store.insertAttempt({ title: 't' } as never);

    expect(c.rpc).toHaveBeenNthCalledWith(
      1,
      'gigl_worker_deactivate_notification_push_tokens',
      {
        p_id: 'n-1',
        p_reason: 'DeviceNotRegistered',
        p_tokens: ['a'],
        p_worker_id: 'w-1',
      }
    );
    expect(c.rpc).toHaveBeenNthCalledWith(
      2,
      'gigl_worker_record_notification_push_attempt',
      { p_attempt: { title: 't' }, p_id: 'n-1', p_worker_id: 'w-1' }
    );
  });

  it('reports a lost lease as a store error instead of a silent no-op', async () => {
    const c = client({ data: false });
    const store = createGiglNotificationPushStore(c, lease);

    await expect(store.insertAttempt({} as never)).resolves.toEqual({
      error: { message: 'Notification lease is no longer active' },
    });
  });
});
