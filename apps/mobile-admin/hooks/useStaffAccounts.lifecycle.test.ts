// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStaffAccountsWrapper,
  getStaffAccountsMocks,
  getUseStaffAccounts,
  resetStaffAccountsMocks,
} from './useStaffAccounts.test-support';

const mocks = getStaffAccountsMocks();
const useStaffAccounts = getUseStaffAccounts();

describe('useStaffAccounts merchant lifecycle', () => {
  beforeEach(resetStaffAccountsMocks);

  it('suppresses stale staff-account success callbacks, alerts, and cache invalidation after switching to B', async () => {
    let resolveAccount!: (response: {
      json: () => Promise<unknown>;
      ok: boolean;
    }) => void;
    const accountResponse = new Promise<{
      json: () => Promise<unknown>;
      ok: boolean;
    }>((resolve) => {
      resolveAccount = resolve;
    });
    const fetchSpy = vi.fn().mockReturnValueOnce(accountResponse);
    const onAccountCreated = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { queryClient, Wrapper } = createStaffAccountsWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result, rerender } = renderHook(
      () => useStaffAccounts({ onAccountCreated }),
      { wrapper: Wrapper }
    );

    const save = result.current.createAccountMutation.mutateAsync({
      name: 'Ada Till',
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    mocks.merchant = { id: 'merchant-2' };
    rerender();
    await act(async () => {
      resolveAccount({ json: async () => ({ success: true }), ok: true });
      await save;
    });

    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      destinations: [],
      merchantId: 'merchant-1',
      name: 'Ada Till',
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onAccountCreated).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('suppresses stale staff-account errors after switching to B', async () => {
    let rejectAccount!: (error: Error) => void;
    const accountResponse = new Promise<void>((_resolve, reject) => {
      rejectAccount = reject;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(accountResponse));
    const { Wrapper } = createStaffAccountsWrapper();
    const { result, rerender } = renderHook(
      () => useStaffAccounts({ onAccountCreated: vi.fn() }),
      { wrapper: Wrapper }
    );

    const save = result.current.createAccountMutation
      .mutateAsync({ name: 'Ada Till' })
      .catch((error: unknown) => error);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    mocks.merchant = { id: 'merchant-2' };
    rerender();
    await act(async () => {
      rejectAccount(new Error('account API failed'));
      await save;
    });

    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('suppresses stale branch success callbacks, alerts, and cache invalidation after switching to B', async () => {
    let resolveBranch!: () => void;
    mocks.createBranch.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveBranch = resolve;
      })
    );
    const onBranchCreated = vi.fn();
    const { queryClient, Wrapper } = createStaffAccountsWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result, rerender } = renderHook(
      () => useStaffAccounts({ onAccountCreated: vi.fn(), onBranchCreated }),
      { wrapper: Wrapper }
    );

    const createBranch = result.current.createBranchMutation.mutateAsync({
      name: 'Lagos main',
      city: 'Lagos',
    });
    await waitFor(() => expect(mocks.createBranch).toHaveBeenCalledOnce());
    mocks.merchant = { id: 'merchant-2' };
    rerender();
    await act(async () => {
      resolveBranch();
      await createBranch;
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onBranchCreated).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
