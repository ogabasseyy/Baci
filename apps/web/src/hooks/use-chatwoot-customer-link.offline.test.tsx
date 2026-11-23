import { renderHook } from '@testing-library/react';
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
  MARKER,
  publishIdentity,
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
    expect(deleteCustomAttribute).toHaveBeenCalledTimes(1);

    // The request inside the widget was lost with the connection.
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    expect(deleteCustomAttribute).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the removal when the sign-out went out online', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    signOut();
    window.dispatchEvent(new Event('online'));

    expect(deleteCustomAttribute).toHaveBeenCalledTimes(1);
  });

  it('does not remove the note of a shopper who signed in again meanwhile', () => {
    renderHook(() => useChatwootCustomerLink('ogabassey', true));

    setOnline(false);
    signOut();
    mocks.hint.mockReturnValue('1');
    setOnline(true);
    window.dispatchEvent(new Event('online'));

    expect(deleteCustomAttribute).toHaveBeenCalledTimes(1);
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

    expect(deleteCustomAttribute).toHaveBeenCalledTimes(1);
  });
});
