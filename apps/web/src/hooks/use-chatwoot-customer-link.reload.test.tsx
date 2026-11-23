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

import {
  deleteCustomAttribute,
  installHarness,
  json,
  setCustomAttributes,
  uninstallHarness,
} from './use-chatwoot-customer-link.test-support';

const cookieMarker = () =>
  document.cookie.includes('baci_chat_link_ogabassey=1');

/** A fresh page load: the hook module (and its memory) is loaded again. */
async function freshHook() {
  vi.resetModules();
  const module = await import('./use-chatwoot-customer-link');
  return module.useChatwootCustomerLink;
}

beforeEach(() => installHarness(mocks));
afterEach(() => uninstallHarness());

describe('useChatwootCustomerLink across page loads', () => {
  it('bugfix: removes a previous customer link on a guest page load even when local storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));

    // Page load 1: a signed-in shopper is linked. Storage refuses the marker.
    const first = await freshHook();
    renderHook(() => first('ogabassey', true));
    await vi.waitFor(() => expect(setCustomAttributes).toHaveBeenCalled());
    expect(window.localStorage.getItem('baci-chat-link:ogabassey')).toBeNull();
    expect(cookieMarker()).toBe(true);

    // Page load 2: the shopper is a guest now; memory is gone, storage empty.
    mocks.hint.mockReturnValue('0');
    const second = await freshHook();
    renderHook(() => second('ogabassey', true));

    expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link');
    expect(cookieMarker()).toBe(false);
  });

  it('costs a guest who was never linked nothing: no removal request on page load', async () => {
    mocks.hint.mockReturnValue(null);
    const hook = await freshHook();
    renderHook(() => hook('ogabassey', true));

    expect(deleteCustomAttribute).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('sets the marker cookie when a customer is linked and clears it on sign-out', async () => {
    mocks.fetch.mockResolvedValue(json(200, { token: 'signed.token' }));
    const hook = await freshHook();
    renderHook(() => hook('ogabassey', true));
    await vi.waitFor(() => expect(setCustomAttributes).toHaveBeenCalled());
    expect(cookieMarker()).toBe(true);

    mocks.live.mockReturnValue({
      customerId: null,
      merchantSlug: 'ogabassey',
      userId: null,
    });
    for (const call of mocks.subscribe.mock.calls) call[0]();

    expect(deleteCustomAttribute).toHaveBeenCalled();
    expect(cookieMarker()).toBe(false);
  });
});
