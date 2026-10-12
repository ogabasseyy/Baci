import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { savingsDraftFixture } from '@/lib/customer-savings-draft.test-fixture';
import { customerSavingsDraftView } from '@/lib/customer-savings-draft-view';
import { useCustomerSavingsDrafts } from './use-customer-savings-drafts';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  catalogue: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  accept: vi.fn(),
  close: vi.fn(),
  requestId: vi.fn(),
  invalidate: () => {},
}));
vi.mock('@/lib/customer-savings-draft-browser', () => ({
  createCustomerSavingsDraftBrowser: (
    _scope: unknown,
    invalidate: () => void
  ) => {
    mocks.invalidate = invalidate;
    return mocks;
  },
}));
vi.mock('@/lib/customer-savings-draft-browser-request-id', () => ({
  customerSavingsDraftBrowserRequestId: (...args: unknown[]) =>
    mocks.requestId(...args),
}));
const fixture = savingsDraftFixture();
const draft = customerSavingsDraftView(fixture.record);
const scope = { merchantId: fixture.merchantId, userId: draft.draftId };
const selection = { productId: draft.productId, variantId: draft.variantId };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.catalogue.mockResolvedValue([]);
  mocks.create.mockResolvedValue(draft);
  mocks.read.mockResolvedValue(draft);
  mocks.requestId.mockResolvedValue(draft.requestId);
  mocks.accept.mockResolvedValue({
    ...draft,
    consent: 'accepted',
    acceptedAt: '2026-09-13T12:01:00Z',
  });
});
it('guards double clicks and accepts only the saved server revision', async () => {
  const { result } = renderHook(() => useCustomerSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => {
    await Promise.all([
      result.current.create(selection),
      result.current.create(selection),
    ]);
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(() => result.current.accept());
  expect(result.current.draft?.consent).toBe('accepted');
  expect(mocks.accept).toHaveBeenCalledWith(draft);
});
it('retains replacement identity and clears the old receipt across unknown response recovery', async () => {
  const { result } = renderHook(() => useCustomerSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(() => result.current.create(selection));
  mocks.accept.mockRejectedValue(
    Object.assign(new Error('stale'), {
      code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
      status: 409,
    })
  );
  await act(() => result.current.accept());
  expect(result.current.canReplace).toBe(true);
  const replacement = {
    ...draft,
    requestId: '30000000-0000-4000-8000-000000000002',
    revisionId: '40000000-0000-4000-8000-000000000002',
  };
  mocks.requestId.mockResolvedValue(replacement.requestId);
  mocks.create.mockRejectedValue(new Error('timeout'));
  await act(() => result.current.replace());
  expect(result.current.draft).toBeNull();
  expect(result.current.canRetry).toBe(true);
  expect(mocks.requestId).toHaveBeenLastCalledWith(
    scope,
    selection,
    draft.requestId
  );
  mocks.list.mockResolvedValue([replacement]);
  await act(() => result.current.retry());
  expect(mocks.requestId).toHaveBeenLastCalledWith(scope, selection, undefined);
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(result.current.draft).toEqual(replacement);
});
it('does not rotate after timeout or publish an old response after logout', async () => {
  const { result } = renderHook(() => useCustomerSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(() => result.current.create(selection));
  mocks.accept.mockRejectedValue(new Error('timeout'));
  await act(() => result.current.accept());
  await act(() => result.current.replace());
  expect(mocks.requestId).toHaveBeenCalledTimes(1);
  let resolveRead: (value: typeof draft) => void = () => {};
  mocks.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      })
  );
  let reading: Promise<void>;
  act(() => {
    reading = result.current.open(draft.draftId);
  });
  act(() => mocks.invalidate());
  await act(async () => {
    resolveRead(draft);
    await reading;
  });
  expect(result.current.expired).toBe(true);
  expect(result.current.draft).toBeNull();
});
it('does not dispatch creation after unmount during storage recovery', async () => {
  const { result, unmount } = renderHook(() => useCustomerSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  let resolveId: (value: string) => void = () => {};
  mocks.requestId.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveId = resolve;
      })
  );
  let creating: Promise<void>;
  act(() => {
    creating = result.current.create(selection);
  });
  unmount();
  await act(async () => {
    resolveId(draft.requestId);
    await creating;
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalled();
});
