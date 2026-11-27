import { act, renderHook } from '@testing-library/react';
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
  notifyOtherTab,
  publishIdentity,
  setNote,
  uninstallHarness,
} from './use-chatwoot-customer-link.test-support';

const later = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  installHarness(mocks);
  vi.useFakeTimers();
});
afterEach(() => uninstallHarness());

describe('bugfix: one passing error left a signed-in shopper unlinked', () => {
  it('asks once more shortly after a failed first check and links them', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(200, { token: 'signed.token' }));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await later(15_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(setNote).toHaveBeenCalledWith({
      baci_customer_link: 'signed.token',
    });
  });

  it('tries only once more, and leaves a never-linked chat untouched', async () => {
    mocks.fetch.mockRejectedValue(new Error('network'));

    // Its own store: the hook remembers linked stores for the life of the page,
    // so one linked by an earlier test would not count as never linked.
    renderHook(() => useChatwootCustomerLink('never-linked-store', true));
    await later(120_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it('bugfix: an account that took over in another tab gets its own second try', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(200, { token: 'account.b' }));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await later(15_000); // Account A has used its one retry.
    expect(mocks.fetch).toHaveBeenCalledTimes(2);

    // Later, another tab switched to account B; the hint still says signed in.
    await later(60_000);
    act(() => notifyOtherTab());
    await later(15_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(setNote).toHaveBeenCalledWith({
      baci_customer_link: 'account.b',
    });
  });

  it('gives no further try when this tab is only looked at again', async () => {
    mocks.fetch.mockResolvedValue(json(503));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await later(15_000);
    await later(60_000);
    act(() => notifyOtherTab('resume'));
    await later(120_000);

    // The first check, its retry, and the one check for the refocus.
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not ask again when the server says there is no session', async () => {
    mocks.fetch.mockResolvedValue(json(401));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await later(120_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('drops the retry when the shopper signs out meanwhile', async () => {
    mocks.fetch.mockResolvedValue(json(503));

    renderHook(() => useChatwootCustomerLink('ogabassey', true));
    await later(0);
    mocks.hint.mockReturnValue('0');
    mocks.live.mockReturnValue({ customerId: null, userId: null });
    act(() => publishIdentity());
    await later(120_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('drops the retry when the page is left', async () => {
    mocks.fetch.mockResolvedValue(json(503));

    const { unmount } = renderHook(() =>
      useChatwootCustomerLink('ogabassey', true)
    );
    await later(0);
    unmount();
    await later(120_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
