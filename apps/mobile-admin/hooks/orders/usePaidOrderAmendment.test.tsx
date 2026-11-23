import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaidOrderAmendmentError } from '@/lib/paid-order-amendment-api';
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

async function openHook() {
  const hook = renderAmendmentHook();
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

  it('checks the server when the local recovery state cannot be read', async () => {
    mocks.get.mockRejectedValue(new Error('Storage unavailable'));
    const { result } = renderAmendmentHook(true);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledOnce());
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

  it('persists the exact command before dispatch and clears it on success', async () => {
    const { result } = await openHook();
    mocks.confirm.mockImplementationOnce(async () => {
      expect(persisted).toBe(JSON.stringify(confirmation));
    });
    await act(async () => {
      await expect(result.current.confirm(confirmation)).resolves.toBe(
        'confirmed'
      );
    });
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith(
      storageKey,
      JSON.stringify(confirmation)
    );
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(order, confirmation);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(storageKey);
    await waitFor(() => expect(result.current.pending).toBeNull());
  });

  it.each([
    [confirmation.idempotencyKey, 'confirmed'],
    ['other-confirmation', 'competing'],
  ])('matches a possibly committed confirmation to the server key %s', async (key, outcome) => {
    const { result } = await openHook();
    mocks.confirm.mockRejectedValueOnce(new Error('Response lost'));
    mocks.workspace.mockResolvedValue({
      ...amendedWorkspace,
      confirmationKey: key,
    });
    await act(async () => {
      await expect(result.current.confirm(confirmation)).resolves.toBe(outcome);
    });
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(persisted).toBeNull();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('restores an unknown confirmation on restart and retries the same POS payload', async () => {
    const first = await openHook();
    mocks.confirm.mockRejectedValueOnce(new Error('Connection lost'));
    await act(async () => {
      await expect(first.result.current.confirm(confirmation)).resolves.toBe(
        'unknown'
      );
    });
    await waitFor(() =>
      expect(first.result.current.pending).toEqual(confirmation)
    );
    first.unmount();

    const restarted = await openHook();
    const restored = restarted.result.current.pending;
    expect(restored).toEqual(confirmation);
    if (!restored) throw new Error('Missing restored confirmation');
    await act(async () => {
      await expect(restarted.result.current.confirm(restored)).resolves.toBe(
        'confirmed'
      );
    });
    expect(mocks.confirm.mock.calls).toEqual([
      [order, confirmation],
      [order, confirmation],
    ]);
    expect(persisted).toBeNull();
    await waitFor(() => expect(restarted.result.current.pending).toBeNull());
  });

  it('clears a new command after an authoritative rejection', async () => {
    const { result } = await openHook();
    const rejected = new PaidOrderAmendmentError(
      'Order changed',
      409,
      'preview_stale'
    );
    mocks.confirm.mockRejectedValueOnce(rejected);
    await act(async () => {
      await expect(result.current.confirm(confirmation)).rejects.toBe(rejected);
    });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(storageKey);
    await waitFor(() => expect(result.current.pending).toBeNull());
  });

  it.each([
    'staff_pos_receipt_used',
    'scenario_disabled',
    'bank_evidence_required',
  ])('clears a recovered confirmation on a definitive %s conflict', async (code) => {
    persisted = JSON.stringify(confirmation);
    const { result } = await openHook();
    const rejected = new PaidOrderAmendmentError(
      'This confirmation cannot be applied.',
      409,
      code
    );
    mocks.confirm.mockRejectedValueOnce(rejected);
    expect(result.current.pending).toEqual(confirmation);
    await act(async () => {
      await expect(result.current.confirm(confirmation)).rejects.toBe(rejected);
    });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(storageKey);
    await waitFor(() => expect(result.current.pending).toBeNull());
  });

  it('retains a recovered confirmation if access to the order is lost', async () => {
    persisted = JSON.stringify(confirmation);
    const { result } = await openHook();
    mocks.confirm.mockRejectedValueOnce(
      new PaidOrderAmendmentError('Order not found', 404)
    );
    mocks.workspace.mockRejectedValue(
      new PaidOrderAmendmentError('Order not found', 404)
    );
    await act(async () => {
      await expect(result.current.confirm(confirmation)).resolves.toBe(
        'unknown'
      );
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(persisted).toBe(JSON.stringify(confirmation));
  });
});
