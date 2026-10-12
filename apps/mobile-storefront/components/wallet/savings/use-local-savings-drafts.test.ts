import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { SavingsDraft } from '@/schemas/customer-savings-drafts';
import { draftFixture } from '@/schemas/customer-savings-drafts.test-fixture';
import { useLocalSavingsDrafts } from './use-local-savings-drafts';

const mockList = jest.fn<() => Promise<SavingsDraft[]>>();
const mockCreate = jest.fn<() => Promise<SavingsDraft>>();
const mockRead = jest.fn<() => Promise<SavingsDraft>>();
const mockAccept = jest.fn<() => Promise<SavingsDraft>>();
const mockRequestId = jest.fn<(...args: unknown[]) => Promise<string>>();
jest.mock('@/lib/customer-savings-drafts', () => ({
  customerSavingsDrafts: {
    list: (...args: unknown[]) => mockList(...(args as [])),
    create: (...args: unknown[]) => mockCreate(...(args as [])),
    read: (...args: unknown[]) => mockRead(...(args as [])),
    accept: (...args: unknown[]) => mockAccept(...(args as [])),
  },
}));
jest.mock('@/lib/savings-draft-request-id', () => ({
  savingsDraftRequestId: (...args: unknown[]) => mockRequestId(...args),
}));
const scope = { userId: 'customer', merchantId: 'merchant' };
beforeEach(() => {
  mockRequestId.mockReset().mockResolvedValue(draftFixture.requestId);
  mockList.mockReset().mockResolvedValue([]);
  mockCreate.mockReset().mockResolvedValue(draftFixture);
  mockRead.mockReset().mockResolvedValue(draftFixture);
  mockAccept.mockReset().mockResolvedValue({
    ...draftFixture,
    consent: 'accepted',
    acceptedAt: '2026-09-13T07:01:00Z',
  });
});
it('requires definitive stale rejection and explicit action before rotating once to a new receipt', async () => {
  const { result } = renderHook(() => useLocalSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(() =>
    result.current.create(draftFixture.productId, draftFixture.variantId)
  );
  mockAccept.mockRejectedValue(
    Object.assign(new Error('stale'), {
      code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
      status: 409,
    })
  );
  await act(() => result.current.accept());
  expect(result.current.canStartNewDraft).toBe(true);
  expect(mockRequestId).toHaveBeenCalledTimes(1);
  const replacement = {
    ...draftFixture,
    requestId: '30000000-0000-4000-8000-000000000003',
    revisionId: '30000000-0000-4000-8000-000000000004',
  };
  mockRequestId.mockResolvedValue(replacement.requestId);
  mockCreate.mockResolvedValue(replacement);
  await act(async () => {
    await Promise.all([
      result.current.startNewDraft(),
      result.current.startNewDraft(),
    ]);
  });
  expect(mockRequestId).toHaveBeenCalledTimes(2);
  expect(mockRequestId).toHaveBeenLastCalledWith(
    {
      ...scope,
      productId: draftFixture.productId,
      variantId: draftFixture.variantId,
    },
    draftFixture.requestId
  );
  expect(result.current.draft).toEqual(replacement);
  expect(result.current.canStartNewDraft).toBe(false);
});
it('clears the old receipt before new dispatch and retries unknown creation with the retained new id', async () => {
  const { result } = renderHook(() => useLocalSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(() =>
    result.current.create(draftFixture.productId, draftFixture.variantId)
  );
  mockAccept.mockRejectedValue(
    Object.assign(new Error('stale'), {
      code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
      status: 409,
    })
  );
  await act(() => result.current.accept());
  const replacement = {
    ...draftFixture,
    requestId: '30000000-0000-4000-8000-000000000003',
  };
  mockRequestId.mockResolvedValue(replacement.requestId);
  let rejectCreate: (error: Error) => void = () => undefined;
  mockCreate.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectCreate = reject;
      })
  );
  let running: Promise<void>;
  act(() => {
    running = result.current.startNewDraft();
  });
  await waitFor(() => expect(result.current.draft).toBeNull());
  await act(async () => {
    rejectCreate(new Error('timeout'));
    await running;
  });
  expect(result.current.canRetryCreation).toBe(true);
  expect(result.current.canStartNewDraft).toBe(false);
  mockList.mockResolvedValue([replacement]);
  await act(() => result.current.retryCreation());
  expect(mockRequestId).toHaveBeenLastCalledWith(
    {
      ...scope,
      productId: draftFixture.productId,
      variantId: draftFixture.variantId,
    },
    undefined
  );
  expect(result.current.draft).toEqual(replacement);
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
it.each([
  undefined,
  'SAVINGS_DRAFT_CONFLICT',
])('never rotates after unknown acceptance or collision %s', async (code) => {
  const { result } = renderHook(() => useLocalSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(() =>
    result.current.create(draftFixture.productId, draftFixture.variantId)
  );
  mockAccept.mockRejectedValue(
    Object.assign(new Error('unknown'), { code, status: 409 })
  );
  await act(() => result.current.accept());
  await act(() => result.current.startNewDraft());
  expect(result.current.canStartNewDraft).toBe(false);
  expect(mockRequestId).toHaveBeenCalledTimes(1);
});
it('does not publish or dispatch the next request after unmount during recovery', async () => {
  let resolveRequest: (value: string) => void = () => undefined;
  const { result, unmount } = renderHook(() => useLocalSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  mockRequestId.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
  );
  let running: Promise<void>;
  act(() => {
    running = result.current.create(
      draftFixture.productId,
      draftFixture.variantId
    );
  });
  unmount();
  await act(async () => {
    resolveRequest(draftFixture.requestId);
    await running;
  });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockList).toHaveBeenCalledTimes(1);
});
it('creates once, accepts explicit consent, and reloads persisted accepted state', async () => {
  const { result } = renderHook(() => useLocalSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => {
    await Promise.all([
      result.current.create(draftFixture.productId, draftFixture.variantId),
      result.current.create(draftFixture.productId, draftFixture.variantId),
    ]);
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(result.current.draft?.consent).toBe('required');
  await act(() => result.current.accept());
  expect(result.current.draft?.consent).toBe('accepted');
  expect(result.current.draft?.status).toBe('draft');
  mockList.mockResolvedValue([result.current.draft as SavingsDraft]);
  await act(() => result.current.reload());
  expect(result.current.drafts[0].consent).toBe('accepted');
});
it('recovers a committed draft after response loss without creating again', async () => {
  const { result } = renderHook(() => useLocalSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  mockList.mockResolvedValue([draftFixture]);
  await act(() =>
    result.current.create(draftFixture.productId, draftFixture.variantId)
  );
  expect(mockCreate).not.toHaveBeenCalled();
  expect(result.current.draft?.draftId).toBe(draftFixture.draftId);
});
it('keeps failures retryable without claiming consent or balance changes', async () => {
  const { result } = renderHook(() => useLocalSavingsDrafts(scope));
  await waitFor(() => expect(result.current.busy).toBe(false));
  mockCreate.mockRejectedValue(new Error('Response unavailable'));
  await act(() =>
    result.current.create(draftFixture.productId, draftFixture.variantId)
  );
  expect(result.current.error).toMatch(/request is retained/);
  expect(result.current.draft).toBeNull();
});
