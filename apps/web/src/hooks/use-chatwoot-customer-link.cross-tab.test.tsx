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
  notifyOtherTab,
  setCustomAttributes,
  uninstallHarness,
} from './use-chatwoot-customer-link.test-support';

beforeEach(() => installHarness(mocks));
afterEach(() => uninstallHarness());

describe('useChatwootCustomerLink: other tabs, focus bursts and rechecks', () => {
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
    expect(listenerCounts().crossTab).toBe(1);
    unmount();
    expect(listenerCounts().crossTab).toBe(0);
  });

  it('removes the link when a recheck cannot confirm the shopper', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(7_000_000);
    mocks.fetch.mockResolvedValueOnce(json(200, { token: 'account.a' }));
    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await waitFor(() => expect(setCustomAttributes).toHaveBeenCalledTimes(1));

    // A focus or cross-tab notice well after the last sync, hint unchanged.
    now.mockReturnValue(7_060_000);
    mocks.fetch.mockResolvedValueOnce(json(503));
    notifyOtherTab();

    await waitFor(() =>
      expect(deleteCustomAttribute).toHaveBeenCalledWith('baci_customer_link')
    );
  });
});
