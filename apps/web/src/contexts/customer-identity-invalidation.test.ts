import { describe, expect, it, vi } from 'vitest';
import {
  broadcastCustomerIdentityInvalidation,
  subscribeCustomerIdentityInvalidation,
} from './customer-identity-invalidation';

describe('cross-tab customer identity invalidation', () => {
  it('publishes only a store-scoped invalidation without account details', () => {
    broadcastCustomerIdentityInvalidation('ogabassey');
    const notice = JSON.parse(
      window.localStorage.getItem('baci:customer-identity-changed') ?? '{}'
    );
    expect(notice).toEqual(
      expect.objectContaining({ type: 'invalidate', merchantSlug: 'ogabassey' })
    );
    expect(Object.keys(notice).sort()).toEqual([
      'merchantSlug',
      'sequence',
      'source',
      'type',
    ]);
  });

  it('accepts valid identity notices from any store sharing the origin and unsubscribes', () => {
    const listener = vi.fn();
    const subscription = subscribeCustomerIdentityInvalidation(listener);
    expect(subscription.available).toBe(true);
    const send = (value: string) =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'baci:customer-identity-changed',
          newValue: value,
        })
      );
    send('invalid JSON');
    expect(listener).not.toHaveBeenCalled();
    send(
      JSON.stringify({
        type: 'invalidate',
        source: 'another-tab',
        merchantSlug: 'another-store',
        sequence: 1,
      })
    );
    expect(listener).toHaveBeenCalledOnce();
    send(
      JSON.stringify({
        type: 'invalidate',
        source: 'another-tab',
        merchantSlug: 'ogabassey',
        sequence: 2,
      })
    );
    expect(listener).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
    send(
      JSON.stringify({
        type: 'invalidate',
        source: 'another-tab',
        merchantSlug: 'ogabassey',
        sequence: 3,
      })
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('delivers a publisher notice to a separately initialized tab', async () => {
    vi.resetModules();
    const tabA = await import('./customer-identity-invalidation');
    vi.resetModules();
    const tabB = await import('./customer-identity-invalidation');
    const listener = vi.fn();
    const subscription = tabB.subscribeCustomerIdentityInvalidation(listener);
    tabA.broadcastCustomerIdentityInvalidation('ogabassey');
    const notice = window.localStorage.getItem(
      'baci:customer-identity-changed'
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'baci:customer-identity-changed',
        newValue: notice,
      })
    );
    expect(listener).toHaveBeenCalledOnce();
    subscription.unsubscribe();
  });
});
