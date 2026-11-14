import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyGiglDeliveredProtection } from './gigl-tracking-delivered-protection';

const notifyCustomerWithStore = vi.hoisted(() => vi.fn());
vi.mock('@/lib/expo-client', () => ({ getExpoClient: vi.fn() }));
vi.mock('@/lib/expo-push-messages', () => ({
  activateProtectionMessage: (orderId: string, orderNumber: string) => ({
    body: `order ${orderNumber}`,
    data: { orderId },
    title: 'Activate',
  }),
}));
vi.mock('@/lib/expo-push-core', () => ({ notifyCustomerWithStore }));

const lease = { notificationId: 'n-1', workerId: 'w-1' };
const candidates = {
  customer_id: 'c1',
  customer_user_id: 'u1',
  order_number: 'A-1',
  policies: [{ claim_status: null, id: 'p1', status: 'active' }],
  shipping_status: 'delivered',
};

function clientWith(data: unknown, claimed: unknown = true) {
  const rpc = vi.fn().mockImplementation(async (name: string) => {
    if (name === 'gigl_worker_notification_activation_candidates')
      return { data, error: null };
    if (name === 'gigl_worker_claim_activation_reminder')
      return { data: claimed, error: null };
    return { data: 1, error: null };
  });
  return { rpc };
}

describe('notifyGiglDeliveredProtection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyCustomerWithStore.mockResolvedValue({
      errors: [],
      failed: 0,
      sent: 1,
    });
  });

  it('claims the reminder through the wrapper and sends one customer push', async () => {
    const client = clientWith(candidates);

    await notifyGiglDeliveredProtection(client, lease, 'm1', 'o1');

    expect(client.rpc).toHaveBeenCalledWith(
      'gigl_worker_claim_activation_reminder',
      { p_id: 'n-1', p_policy_id: 'p1', p_worker_id: 'w-1' }
    );
    expect(notifyCustomerWithStore).toHaveBeenCalledWith(
      expect.any(Object),
      'u1',
      'Activate',
      'order A-1',
      { orderId: 'o1' },
      'orders',
      { merchantId: 'm1' }
    );
  });

  it('does nothing before the order is delivered', async () => {
    const client = clientWith({ ...candidates, shipping_status: 'shipped' });

    await notifyGiglDeliveredProtection(client, lease, 'm1', 'o1');

    expect(notifyCustomerWithStore).not.toHaveBeenCalled();
  });

  it('skips a policy whose claim already closed', async () => {
    const client = clientWith({
      ...candidates,
      policies: [{ claim_status: 'paid', id: 'p1', status: 'active' }],
    });

    await notifyGiglDeliveredProtection(client, lease, 'm1', 'o1');

    expect(notifyCustomerWithStore).not.toHaveBeenCalled();
  });

  it('does not send when another delivery already claimed the reminder', async () => {
    const client = clientWith(candidates, false);

    await notifyGiglDeliveredProtection(client, lease, 'm1', 'o1');

    expect(notifyCustomerWithStore).not.toHaveBeenCalled();
  });

  it('releases the claim when nothing was delivered', async () => {
    notifyCustomerWithStore.mockResolvedValue({
      errors: [],
      failed: 0,
      sent: 0,
    });
    const client = clientWith(candidates);

    await notifyGiglDeliveredProtection(client, lease, 'm1', 'o1');

    expect(client.rpc).toHaveBeenCalledWith(
      'gigl_worker_release_activation_reminders',
      { p_id: 'n-1', p_policy_ids: ['p1'], p_worker_id: 'w-1' }
    );
  });

  it('releases the claim when the push throws', async () => {
    notifyCustomerWithStore.mockRejectedValue(new Error('expo down'));
    const client = clientWith(candidates);

    await notifyGiglDeliveredProtection(client, lease, 'm1', 'o1');

    expect(client.rpc).toHaveBeenCalledWith(
      'gigl_worker_release_activation_reminders',
      expect.objectContaining({ p_policy_ids: ['p1'] })
    );
  });
});
