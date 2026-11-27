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
  publishIdentity,
  setNote,
  uninstallHarness,
} from './use-chatwoot-customer-link.test-support';

const setOnline = (online: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });

const signOut = () => {
  mocks.hint.mockReturnValue('0');
  mocks.live.mockReturnValue({
    customerId: null,
    merchantSlug: 'ogabassey',
    userId: null,
  });
  publishIdentity();
};

beforeEach(() => {
  installHarness(mocks);
  window.localStorage.setItem(MARKER, '1');
  mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
});
afterEach(() => {
  setOnline(true);
  uninstallHarness();
});

describe('bugfix: a sign-out while offline still removes the chat link', () => {
  it('sends the removal again when the browser comes back online', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    setOnline(false);
    signOut();
    expect(deleteNote).toHaveBeenCalledTimes(1);

    // The request inside the widget was lost with the connection.
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    expect(deleteNote).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the removal when the sign-out went out online', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    signOut();
    window.dispatchEvent(new Event('online'));

    expect(deleteNote).toHaveBeenCalledTimes(1);
  });

  it('does not remove the note of a shopper who signed in again meanwhile', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    setOnline(false);
    signOut();
    mocks.hint.mockReturnValue('1');
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    expect(deleteNote).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the page is left', () => {
    const { unmount } = renderHook(() =>
      useChatwootCustomerLink('ogabassey', true)
    );
    setOnline(false);
    signOut();
    unmount();

    setOnline(true);
    window.dispatchEvent(new Event('online'));

    expect(deleteNote).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: a shopper whose first link check failed offline is linked when back online', () => {
  it('asks again once the browser is back, without waiting for a focus or reload', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useChatwootCustomerLink('night-store', true));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(setNote).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(setNote).toHaveBeenCalledTimes(1));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not ask again when the shopper is already linked', async () => {
    renderHook(() => useChatwootCustomerLink('linked-store', true));
    await waitFor(() => expect(setNote).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('online'));

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a guest when the browser comes back', () => {
    mocks.hint.mockReturnValue('0');
    renderHook(() => useChatwootCustomerLink('guest-store', true));
    mocks.fetch.mockClear();

    window.dispatchEvent(new Event('online'));

    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('bugfix: a sign-out always takes the previous note off', () => {
  it('overwrites the note with an empty value when the widget has no delete call', () => {
    (window as unknown as { $chatwoot: unknown }).$chatwoot = {
      setConversationCustomAttributes: setNote,
    };
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    setNote.mockClear();

    signOut();

    expect(setNote).toHaveBeenCalledWith({
      baci_customer_link: '',
    });
    expect(deleteNote).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(MARKER)).not.toBe('1');
  });

  it('keeps the record of a linked note while there is no widget to remove it', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    delete (window as unknown as { $chatwoot?: unknown }).$chatwoot;

    signOut();

    // Nothing could be removed, so the next load must try again.
    expect(window.localStorage.getItem(MARKER)).toBe('1');
  });
});
