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
  deleteNote,
  installHarness,
  json,
  MARKER,
  setNote,
  uninstallHarness,
} from './use-chatwoot-customer-link.test-support';

beforeEach(() => installHarness(mocks));
afterEach(() => uninstallHarness());

describe('useChatwootCustomerLink', () => {
  it('sends the signed note to the chat for a signed-in shopper', async () => {
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    await waitFor(() =>
      expect(setNote).toHaveBeenCalledWith({
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
    expect(setNote).not.toHaveBeenCalled();
  });

  it('waits until the chat is ready', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', false));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('removes a stored note once the shopper is signed out', () => {
    window.localStorage.setItem(MARKER, '1');
    mocks.hint.mockReturnValue(null);

    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    expect(deleteNote).toHaveBeenCalledWith('baci_customer_link');
    expect(window.localStorage.getItem(MARKER)).toBeNull();
  });

  it('removes the note when the server says the session is gone', async () => {
    window.localStorage.setItem(MARKER, '1');
    mocks.fetch.mockResolvedValue(json(401));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    await waitFor(() =>
      expect(deleteNote).toHaveBeenCalledWith('baci_customer_link')
    );
    expect(setNote).not.toHaveBeenCalled();
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
    expect(setNote).not.toHaveBeenCalled();
  });

  it('does not throw when the request fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(setNote).not.toHaveBeenCalled();
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
    expect(setNote).not.toHaveBeenCalled();
  });

  it('bugfix: removes a recorded link when the first check on page load cannot be confirmed', async () => {
    // The note may belong to an account that has since signed out and been
    // replaced; a failed check must not leave it for the merchant to trust.
    window.localStorage.setItem(MARKER, '1');
    mocks.fetch.mockResolvedValueOnce(json(503));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    await waitFor(() =>
      expect(deleteNote).toHaveBeenCalledWith('baci_customer_link')
    );
    expect(window.localStorage.getItem(MARKER)).toBeNull();
  });

  it('does not touch the chat when the first check fails for a visitor who was never linked', async () => {
    mocks.fetch.mockResolvedValueOnce(json(503));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it('bugfix: a guest hint removes a leftover link even with no marker, once per page load', () => {
    mocks.hint.mockReturnValue('0');
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    expect(deleteNote).toHaveBeenCalledWith('baci_customer_link');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('removes a leftover link when the server says there is no session, marker or not', async () => {
    mocks.fetch.mockResolvedValue(json(401));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    await waitFor(() =>
      expect(deleteNote).toHaveBeenCalledWith('baci_customer_link')
    );
  });
});
