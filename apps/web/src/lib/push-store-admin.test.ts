import { describe, expect, it, vi } from 'vitest';
import { createAdminPushStore } from './push-store-admin';

function chain() {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ['select', 'eq', 'in', 'gte', 'update', 'insert']) {
    builder[name] = vi.fn(() => builder);
  }
  return builder;
}

describe('createAdminPushStore', () => {
  it('queries the merchant admin tokens with recipient and capability filters', () => {
    const builder = chain();
    const store = createAdminPushStore({ from: vi.fn(() => builder) } as never);

    store.fetchMerchantTokens({
      merchantId: 'm1',
      recipientUserIds: ['u1'],
      requiredCapability: 1,
    });

    expect(builder.eq).toHaveBeenCalledWith('merchant_id', 'm1');
    expect(builder.eq).toHaveBeenCalledWith('app_type', 'admin');
    expect(builder.in).toHaveBeenCalledWith('user_id', ['u1']);
    expect(builder.gte).toHaveBeenCalledWith('shipment_update_capability', 1);
  });

  it('scopes customer tokens to the merchant storefront when given', () => {
    const builder = chain();
    const store = createAdminPushStore({ from: vi.fn(() => builder) } as never);

    store.fetchCustomerTokens({ userId: 'u1', merchantId: 'm1' });

    expect(builder.eq).toHaveBeenCalledWith('app_type', 'storefront');
    expect(builder.eq).toHaveBeenCalledWith('merchant_id', 'm1');
  });

  it('deactivates, stores tickets and attempts on their tables', () => {
    const builder = chain();
    const from = vi.fn((_table: string) => builder);
    const store = createAdminPushStore({ from } as never);

    store.deactivateTokens('DeviceNotRegistered', ['t']);
    store.insertTickets([]);
    store.insertAttempt({} as never);

    expect(from.mock.calls.map(([table]) => table)).toEqual([
      'push_tokens',
      'push_notification_tickets',
      'push_notification_attempts',
    ]);
    expect(builder.in).toHaveBeenCalledWith('token', ['t']);
  });
});
