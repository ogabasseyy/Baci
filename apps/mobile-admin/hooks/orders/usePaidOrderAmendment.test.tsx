import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaidOrderAmendment } from './usePaidOrderAmendment';

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  confirm: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'operator' } }),
}));
vi.mock('@/lib/api-base-url', () => ({ BASE_URL: 'https://test.invalid' }));
vi.mock('./authenticated-fetch', () => ({
  AuthenticatedFetchPreflightError: class extends Error {},
}));
vi.mock(import('@/lib/paid-order-amendment-api'), async (load) => {
  const actual = await load();
  return {
    ...actual,
    paidOrderAmendment: {
      ...actual.paidOrderAmendment,
      workspace: mocks.workspace,
      confirm: mocks.confirm,
    },
  };
});
vi.mock('@/lib/storage', () => ({
  asyncStorage: {
    getItem: mocks.get,
    setItem: mocks.set,
    removeItem: mocks.remove,
  },
}));

const order = 'order';
const merchant = 'merchant';
const storageKey = 'paid-order-amendment:operator:merchant:order';
const confirmation = {
  previewId: '42778a83-0ed7-4fa5-9e1d-4ea7a085b217',
  idempotencyKey: 'f58ed34e-0761-4ffe-83f4-a4cb4bdcce14',
  customerAgreed: true as const,
  reason: 'Customer upgrade',
  staffTopUp: { method: 'pos' as const, receiptReference: 'POS-123456' },
};
const emptyWorkspace = {
  canStart: true,
  canRefund: false,
  summary: null,
  customer: null,
};
const amendedWorkspace = {
  ...emptyWorkspace,
  canStart: false,
  summary: { amendmentId: confirmation.previewId },
  confirmationKey: confirmation.idempotencyKey,
};

function renderAmendmentHook(
  deferWorkspace = false,
  client = new QueryClient()
) {
  return renderHook((defer) => usePaidOrderAmendment(order, merchant, defer), {
    initialProps: deferWorkspace,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

async function openHook(client = new QueryClient()) {
  const hook = renderAmendmentHook(false, client);
  await waitFor(() => expect(hook.result.current.pending).not.toBeUndefined());
  await waitFor(() => expect(hook.result.current.canStart).toBe(true));
  return hook;
}

describe('usePaidOrderAmendment', () => {
  let persisted: string | null;
  beforeEach(() => {
    vi.resetAllMocks();
    persisted = null;
    mocks.get.mockImplementation(async () => persisted);
    mocks.set.mockImplementation(async (_key, value) => {
      persisted = value;
    });
    mocks.remove.mockImplementation(async () => {
      persisted = null;
    });
    mocks.workspace.mockResolvedValue(emptyWorkspace);
    mocks.confirm.mockResolvedValue({ amendmentId: confirmation.previewId });
  });

  it('skips the workspace for an unpaid order until its payment details change', async () => {
    const { result, rerender } = renderAmendmentHook(true);
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(result.current.canStart).toBe(false);

    rerender(false);
    await waitFor(() => expect(result.current.canStart).toBe(true));
    expect(mocks.workspace).toHaveBeenCalledOnce();
  });

  it('loads the workspace for an unpaid snapshot with a saved confirmation', async () => {
    persisted = JSON.stringify(confirmation);
    mocks.workspace.mockResolvedValue(amendedWorkspace);
    const { result } = renderAmendmentHook(true);
    await waitFor(() => expect(result.current.pending).toEqual(confirmation));
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledOnce());
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('blocks a malformed saved command until order status reloads successfully', async () => {
    persisted = '{malformed';
    const { result, rerender } = renderAmendmentHook(true);
    await waitFor(() => expect(result.current.pendingUnreadable).toBe(true));
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledOnce());
    expect(result.current.canStart).toBe(false);

    await act(async () => {
      await result.current.recoverUnreadableConfirmation();
    });

    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(storageKey);
    await waitFor(() => expect(result.current.pendingUnreadable).toBe(false));
    expect(result.current.pending).toBeNull();
    rerender(false);
    await waitFor(() => expect(result.current.canStart).toBe(true));
  });

  it('treats a saved command with an invalid schema as unreadable', async () => {
    persisted = JSON.stringify({ ...confirmation, customerAgreed: false });
    const { result } = renderAmendmentHook(true);
    await waitFor(() => expect(result.current.pendingUnreadable).toBe(true));
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledOnce());
    expect(result.current.pending).toBeNull();
    expect(result.current.canStart).toBe(false);
  });

  it('checks the server when the local recovery state cannot be read', async () => {
    mocks.get.mockRejectedValue(new Error('Storage unavailable'));
    const { result } = renderAmendmentHook(true);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.pendingUnreadable).toBe(true));
    expect(result.current.canStart).toBe(false);
  });

  it('refreshes known settlement recovery even if the order snapshot looks unpaid', async () => {
    const client = new QueryClient();
    const recovery = {
      ...amendedWorkspace,
      canRefund: true,
      isVerifiedFunding: true,
      verifiedCancellationPending: true,
    };
    client.setQueryData(
      ['paid-order-amendment', 'operator', merchant, order],
      recovery
    );
    mocks.workspace.mockResolvedValue(recovery);
    const { result } = renderAmendmentHook(true, client);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledOnce());
    expect(result.current.verification).toEqual(recovery);
  });

  it('keeps the newest workspace when an older refresh finishes last', async () => {
    const client = new QueryClient();
    const { result } = await openHook(client);
    const older = { ...amendedWorkspace, summary: { amendmentId: 'older' } };
    const newer = { ...amendedWorkspace, summary: { amendmentId: 'newer' } };
    let resolveOlder: (value: typeof older) => void = () => undefined;
    let resolveNewer: (value: typeof newer) => void = () => undefined;
    mocks.workspace.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOlder = resolve))
    );
    let olderRefresh: Promise<boolean> | undefined;
    await act(async () => {
      olderRefresh = result.current.refreshOrder();
      await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(2));
    });
    mocks.workspace.mockImplementationOnce(
      () => new Promise((resolve) => (resolveNewer = resolve))
    );
    let newerRefresh: Promise<boolean> | undefined;
    await act(async () => {
      newerRefresh = result.current.refreshOrder();
      await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(3));
    });
    if (!olderRefresh || !newerRefresh)
      throw new Error('Refresh did not start');
    await act(async () => resolveNewer(newer));
    await expect(newerRefresh).resolves.toBe(true);
    await act(async () => resolveOlder(older));
    await expect(olderRefresh).resolves.toBe(false);
    expect(
      client.getQueryData(['paid-order-amendment', 'operator', merchant, order])
    ).toEqual(newer);
  });

  it('returns promptly when a workspace refresh starts offline', async () => {
    const { result } = await openHook();
    onlineManager.setOnline(false);
    try {
      await expect(result.current.refreshOrder()).resolves.toBe(false);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('ignores an outstanding refresh after its hook unmounts', async () => {
    const client = new QueryClient();
    const old = await openHook(client);
    const stale = { ...amendedWorkspace, summary: { amendmentId: 'stale' } };
    const fresh = { ...amendedWorkspace, summary: { amendmentId: 'fresh' } };
    let resolveStale: (value: typeof stale) => void = () => undefined;
    mocks.workspace.mockImplementationOnce(
      () => new Promise((resolve) => (resolveStale = resolve))
    );
    let oldRefresh: Promise<boolean> | undefined;
    await act(async () => {
      oldRefresh = old.result.current.refreshOrder();
      await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(2));
    });
    if (!oldRefresh) throw new Error('Refresh did not start');
    old.unmount();

    mocks.workspace.mockResolvedValue(fresh);
    const replacement = renderAmendmentHook(false, client);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(
        client.getQueryData([
          'paid-order-amendment',
          'operator',
          merchant,
          order,
        ])
      ).toEqual(fresh)
    );
    await act(async () => resolveStale(stale));
    await expect(oldRefresh).resolves.toBe(false);
    expect(
      client.getQueryData(['paid-order-amendment', 'operator', merchant, order])
    ).toEqual(fresh);
    replacement.unmount();
  });
});
