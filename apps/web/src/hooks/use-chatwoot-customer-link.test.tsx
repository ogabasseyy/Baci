import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), hint: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
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
});

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
});
