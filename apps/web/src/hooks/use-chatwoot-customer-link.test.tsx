import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  hint: vi.fn(),
  subscribe: vi.fn(),
  live: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/contexts/customer-live-identity', () => ({
  subscribeCustomerIdentityChange: mocks.subscribe,
  getLiveCustomerIdentity: mocks.live,
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
  mocks.subscribe.mockImplementation((listener: () => void) => {
    identityListeners.push(listener);
    return () => {
      identityListeners.splice(identityListeners.indexOf(listener), 1);
    };
  });
});

/** Simulates the auth context publishing an identity change. */
const identityListeners: Array<() => void> = [];
const publishIdentity = () => {
  for (const listener of [...identityListeners]) listener();
};

afterEach(() => {
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
});
