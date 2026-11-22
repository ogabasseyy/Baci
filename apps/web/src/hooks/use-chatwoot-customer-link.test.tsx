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

const setCustomAttributes = vi.fn();
const deleteCustomAttribute = vi.fn();
const MARKER = 'baci-chat-link:ogabassey';

const json = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
  (window as unknown as { $chatwoot: unknown }).$chatwoot = {
    setCustomAttributes,
    deleteCustomAttribute,
  };
  mocks.hint.mockReturnValue('1');
  mocks.live.mockReturnValue({
    customerId: 'c1',
    merchantSlug: 'ogabassey',
    userId: 'u1',
  });
  identityListeners.length = 0;
  crossTabListeners.length = 0;
  mocks.crossTab.mockImplementation((listener: () => void) => {
    crossTabListeners.push(listener);
    return {
      available: true,
      unsubscribe: () => {
        crossTabListeners.splice(crossTabListeners.indexOf(listener), 1);
      },
    };
  });
  mocks.subscribe.mockImplementation((listener: () => void) => {
    identityListeners.push(listener);
    return () => {
      identityListeners.splice(identityListeners.indexOf(listener), 1);
    };
  });
});

/** Simulates a notice from another tab (or a focus/visibility event). */
const crossTabListeners: Array<() => void> = [];
const notifyOtherTab = () => {
  for (const listener of [...crossTabListeners]) listener();
};

/** Simulates the auth context publishing an identity change. */
const identityListeners: Array<() => void> = [];
const publishIdentity = () => {
  for (const listener of [...identityListeners]) listener();
};

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { $chatwoot?: unknown }).$chatwoot;
});

describe('useChatwootCustomerLink', () => {
  it('sends the signed note to the chat for a signed-in shopper', async () => {
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenCalledWith({
        baci_customer_link: 'signed.token',
      })
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/customer-link',
      { method: 'POST', body: JSON.stringify({ storeSlug: 'ogabassey' }) }
    );
    expect(window.localStorage.getItem(MARKER)).toBe('1');
  });

  it('makes no request for a guest', () => {
    mocks.hint.mockReturnValue('0');
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(setCustomAttributes).not.toHaveBeenCalled();
  });

  it('waits until the chat is ready', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', false));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('removes a stored note once the shopper is signed out', () => {
    window.localStorage.setItem(MARKER, '1');
    mocks.hint.mockReturnValue(null);

    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
    expect(window.localStorage.getItem(MARKER)).toBeNull();
  });

  it('removes the note when the server says the session is gone', async () => {
    window.localStorage.setItem(MARKER, '1');
    mocks.fetch.mockResolvedValue(json(401));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    await waitFor(() =>
      expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link')
    );
    expect(setCustomAttributes).not.toHaveBeenCalled();
  });

  it.each([
    ['a server error', json(503)],
    ['an answer with no token', json(200, {})],
    ['a token that is not text', json(200, { token: 7 })],
  ])('leaves the chat alone after %s', async (_name, response) => {
    mocks.fetch.mockResolvedValue(response);
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(setCustomAttributes).not.toHaveBeenCalled();
  });

  it('does not throw when the request fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(setCustomAttributes).not.toHaveBeenCalled();
  });

  it('does nothing when the chat arrives after the page is left', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { unmount } = renderHook(() =>
      useChatwootCustomerLink('ogabassey', true)
    );
    unmount();
    finish(json(200, { token: 'late.token' }));
    await Promise.resolve();
    expect(setCustomAttributes).not.toHaveBeenCalled();
  });

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
    expect(identityListeners).toHaveLength(1);
    unmount();
    expect(identityListeners).toHaveLength(0);
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

  it('bugfix: removes the link when the shopper signs out in another tab', () => {
    window.localStorage.setItem(MARKER, '1');
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    // The other tab signed out: the shared session-hint cookie now says so.
    mocks.hint.mockReturnValue('0');
    notifyOtherTab();

    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
    expect(window.localStorage.getItem(MARKER)).toBeNull();
  });

  it('bugfix: still removes it when storage is blocked and no marker survived', () => {
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    mocks.hint.mockReturnValue(null);
    notifyOtherTab();

    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
  });

  it('bugfix: replaces the link when another tab switched to a different account', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    mocks.fetch
      .mockResolvedValueOnce(json(200, { token: 'account.a' }))
      .mockResolvedValueOnce(json(200, { token: 'account.b' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenCalledWith({
        baci_customer_link: 'account.a',
      })
    );

    // Long enough after the last sync that a notice is worth a fresh check.
    now.mockReturnValue(1_060_000);
    notifyOtherTab();

    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenLastCalledWith({
        baci_customer_link: 'account.b',
      })
    );
  });

  it('asks the server once, later, for a burst of focus notices', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(2_000_000);
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalled());

    vi.setSystemTime(2_001_000);
    notifyOtherTab();
    notifyOtherTab();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    // One trailing check for the whole burst, not one per notice.
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('bugfix: a throttled account switch still gets a later check and replaces the link', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(3_000_000);
    mocks.fetch
      .mockResolvedValueOnce(json(200, { token: 'account.a' }))
      .mockResolvedValueOnce(json(200, { token: 'account.b' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenCalledWith({
        baci_customer_link: 'account.a',
      })
    );

    // Another tab switched account one second later: the hint is still '1',
    // and the notice arrives inside the throttle window.
    vi.setSystemTime(3_001_000);
    notifyOtherTab();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenLastCalledWith({
        baci_customer_link: 'account.b',
      })
    );
  });

  it('bugfix: drops an answer for the old account when a throttled notice arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(4_000_000);
    let finishA: (value: unknown) => void = () => {};
    mocks.fetch
      .mockReturnValueOnce(new Promise((resolve) => (finishA = resolve)))
      .mockResolvedValueOnce(json(200, { token: 'account.b' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    vi.setSystemTime(4_001_000);
    notifyOtherTab();
    finishA(json(200, { token: 'account.a' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(setCustomAttributes).not.toHaveBeenCalledWith({
      baci_customer_link: 'account.a',
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() =>
      expect(setCustomAttributes).toHaveBeenCalledWith({
        baci_customer_link: 'account.b',
      })
    );
  });

  it('cancels a scheduled check when another tab then signs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(5_000_000);
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalled());

    vi.setSystemTime(5_001_000);
    notifyOtherTab(); // throttled: a check is scheduled
    mocks.hint.mockReturnValue('0');
    notifyOtherTab(); // signed out: the scheduled check must not run
    await vi.advanceTimersByTimeAsync(20_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
  });

  it('cancels a scheduled check when the chat goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(6_000_000);
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    const { unmount } = renderHook(() =>
      useChatwootCustomerLink('ogabassey', true)
    );
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalled());

    vi.setSystemTime(6_001_000);
    notifyOtherTab(); // throttled: a check is scheduled
    unmount();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('drops an answer that arrives after another tab signed out', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    mocks.hint.mockReturnValue('0');
    notifyOtherTab();
    finish(json(200, { token: 'old.account.token' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setCustomAttributes).not.toHaveBeenCalled();
  });

  it('stops listening to other tabs when the chat goes away', () => {
    const { unmount } = renderHook(() =>
      useChatwootCustomerLink('ogabassey', true)
    );
    expect(crossTabListeners).toHaveLength(1);
    unmount();
    expect(crossTabListeners).toHaveLength(0);
  });
});
