import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  hint: vi.fn(),
  subscribe: vi.fn(),
  live: vi.fn(),
  crossTab: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/contexts/customer-live-identity', () => ({
  subscribeCustomerIdentityChange: mocks.subscribe,
  getLiveCustomerIdentity: mocks.live,
}));
vi.mock('@/contexts/customer-identity-invalidation', () => ({
  subscribeCustomerIdentityInvalidation: mocks.crossTab,
}));
vi.mock('@/contexts/customer-session-hint', () => ({
  readCustomerSessionHint: mocks.hint,
}));

import { useChatwootCustomerLink } from './use-chatwoot-customer-link';
import {
  deleteCustomAttribute,
  installHarness,
  json,
  listenerCounts,
  MARKER,
  publishIdentity,
  setCustomAttributes,
  uninstallHarness,
} from './use-chatwoot-customer-link.test-support';

beforeEach(() => installHarness(mocks));
afterEach(() => uninstallHarness());

describe('useChatwootCustomerLink: same-tab sign-in, sign-out and account switches', () => {
  it('bugfix: links a guest who signs in while the page stays open', async () => {
    mocks.hint.mockReturnValue('0');
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.hint.mockReturnValue('1');
    mocks.fetch.mockResolvedValue(json(200, { token: 'new.token' }));
    publishIdentity();

    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenCalledWith({
        baci_customer_link: 'new.token',
      })
    );
  });

  it('bugfix: removes the link at once when the shopper signs out', () => {
    window.localStorage.setItem(MARKER, '1');
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    mocks.live.mockReturnValue({
      customerId: null,
      merchantSlug: 'ogabassey',
      userId: null,
    });
    publishIdentity();

    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
    expect(window.localStorage.getItem(MARKER)).toBeNull();
  });

  it('bugfix: drops an answer that arrives after the shopper signed out', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    mocks.live.mockReturnValue({
      customerId: null,
      merchantSlug: 'ogabassey',
      userId: null,
    });
    publishIdentity();
    finish(json(200, { token: 'old.account.token' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setCustomAttributes).not.toHaveBeenCalled();
  });

  it('bugfix: replaces the link when the shopper switches account', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(200, { token: 'account.a' }))
      .mockResolvedValueOnce(json(200, { token: 'account.b' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenCalledWith({
        baci_customer_link: 'account.a',
      })
    );

    mocks.live.mockReturnValue({
      customerId: 'c2',
      merchantSlug: 'ogabassey',
      userId: 'u2',
    });
    publishIdentity();

    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenLastCalledWith({
        baci_customer_link: 'account.b',
      })
    );
  });

  it('stops listening when the chat goes away', () => {
    const { unmount } = renderHook(() =>
      useChatwootCustomerLink('ogabassey', true)
    );
    expect(listenerCounts().identity).toBe(1);
    unmount();
    expect(listenerCounts().identity).toBe(0);
  });

  it('bugfix: still removes the link on sign-out when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalled());
    expect(window.localStorage.getItem(MARKER)).toBeNull();

    mocks.live.mockReturnValue({
      customerId: null,
      merchantSlug: 'ogabassey',
      userId: null,
    });
    publishIdentity();

    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
  });

  it('bugfix: removes the previous account link before asking for the new one', async () => {
    mocks.fetch.mockResolvedValueOnce(json(200, { token: 'account.a' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalled());

    let finishB: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValueOnce(
      new Promise((resolve) => (finishB = resolve))
    );
    mocks.live.mockReturnValue({
      customerId: 'c2',
      merchantSlug: 'ogabassey',
      userId: 'u2',
    });
    publishIdentity();

    // Account A's note is already gone while B's request is still pending.
    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
    finishB(json(200, { token: 'account.b' }));
    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenLastCalledWith({
        baci_customer_link: 'account.b',
      })
    );
  });

  it.each([
    ['a server error', () => json(503)],
    ['an answer with no token', () => json(200, {})],
  ])('bugfix: leaves no link on the old account after %s on a switch', async (_name, answer) => {
    mocks.fetch.mockResolvedValueOnce(json(200, { token: 'account.a' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalledTimes(1));

    mocks.fetch.mockResolvedValueOnce(answer());
    mocks.live.mockReturnValue({
      customerId: 'c2',
      merchantSlug: 'ogabassey',
      userId: 'u2',
    });
    publishIdentity();

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
    expect(setCustomAttributes).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(MARKER)).toBeNull();
  });

  it('bugfix: leaves no link on the old account when the switch request fails to connect', async () => {
    mocks.fetch.mockResolvedValueOnce(json(200, { token: 'account.a' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalledTimes(1));

    mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    mocks.live.mockReturnValue({
      customerId: 'c2',
      merchantSlug: 'ogabassey',
      userId: 'u2',
    });
    publishIdentity();

    await waitFor(() =>
      expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link')
    );
    expect(setCustomAttributes).toHaveBeenCalledTimes(1);
  });
});
