import { describe, expect, it, vi } from 'vitest';
import { notifyMerchantWithStore } from './expo-push-core';
import { createLazyExpoGetter } from './expo-push-lazy-client';
import { activateProtectionMessage } from './expo-push-messages';
import type { PushDelivery } from './expo-push-types';

function delivery(overrides: Partial<PushDelivery> = {}): PushDelivery {
  return {
    deactivateTokens: vi.fn(async () => ({ error: null })),
    fetchCustomerTokens: vi.fn(async () => ({ data: [], error: null })),
    fetchMerchantTokens: vi.fn(async () => ({ data: [], error: null })),
    getExpo: vi.fn(),
    insertAttempt: vi.fn(async () => ({ error: null })),
    insertTickets: vi.fn(async () => ({ error: null })),
    ...overrides,
  } as PushDelivery;
}

describe('createLazyExpoGetter', () => {
  it('warns once when no access token is configured and caches the client', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getExpo = createLazyExpoGetter(() => undefined);

    expect(getExpo()).toBe(getExpo());
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('activateProtectionMessage', () => {
  it('names the order and carries the insurance activation payload', () => {
    expect(activateProtectionMessage('o1', 'A-1')).toMatchObject({
      body: expect.stringContaining('#A-1'),
      data: { orderId: 'o1', orderNumber: 'A-1', type: 'insurance_activation' },
    });
  });
});

describe('notifyMerchantWithStore', () => {
  it('delivers to nobody for an empty recipient list without touching the store', async () => {
    const store = delivery();

    const result = await notifyMerchantWithStore(
      store,
      'm',
      't',
      'b',
      undefined,
      'orders',
      {
        recipientUserIds: [],
      }
    );

    expect(result).toEqual({ errors: [], failed: 0, sent: 0 });
    expect(store.fetchMerchantTokens).not.toHaveBeenCalled();
  });

  it('records a skipped attempt through the store when there are no tokens', async () => {
    const store = delivery();

    await notifyMerchantWithStore(
      store,
      'm',
      't',
      'b',
      { type: 'x' },
      'orders',
      {
        recipientUserIds: ['u'],
      }
    );

    expect(store.insertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ merchant_id: 'm', status: 'skipped_no_tokens' })
    );
  });

  it('reports a token lookup failure as a failed attempt', async () => {
    const store = delivery({
      fetchMerchantTokens: vi.fn(async () => ({
        data: null,
        error: { message: 'down' },
      })),
    });

    const result = await notifyMerchantWithStore(store, 'm', 't', 'b');

    expect(result.errors).toEqual(['down']);
    expect(store.insertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_no_tokens' })
    );
  });
});
