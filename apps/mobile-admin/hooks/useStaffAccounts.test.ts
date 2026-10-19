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

describe('useStaffAccounts', () => {
  beforeEach(resetStaffAccountsMocks);

  it('creates branches through branch-api instead of direct Supabase inserts', async () => {
    const onBranchCreated = vi.fn();
    const { queryClient, Wrapper } = createStaffAccountsWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(
      () =>
        useStaffAccounts({
          onAccountCreated: vi.fn(),
          onBranchCreated,
        }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await result.current.createBranchMutation.mutateAsync({
        name: 'Lagos main',
        city: 'Lagos',
      });
    });

    expect(mocks.createBranch).toHaveBeenCalledWith(
      {
        name: 'Lagos main',
        city: 'Lagos',
        isDefault: false,
      },
      'merchant-1'
    );
    expect(mocks.directInsert).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['branches', 'merchant-1', false],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['branch-scope'],
    });
    expect(onBranchCreated).toHaveBeenCalledTimes(1);
  });

  it('surfaces branch API errors without firing the success callback', async () => {
    const onBranchCreated = vi.fn();
    mocks.createBranch.mockRejectedValueOnce(new Error('API down'));
    const { Wrapper } = createStaffAccountsWrapper();
    const { result } = renderHook(
      () =>
        useStaffAccounts({
          onAccountCreated: vi.fn(),
          onBranchCreated,
        }),
      { wrapper: Wrapper }
    );

    let mutationError: unknown;
    await act(async () => {
      try {
        await result.current.createBranchMutation.mutateAsync({
          name: 'Lagos main',
          city: 'Lagos',
        });
      } catch (error) {
        mutationError = error;
      }
    });

    expect(mutationError).toEqual(new Error('API down'));
    expect(onBranchCreated).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith('Error', 'API down');
    });
    expect(mocks.directInsert).not.toHaveBeenCalled();
  });

  it('does not call the branch API when the selected merchant ID is whitespace', async () => {
    mocks.merchant = { id: '  ' };
    const { Wrapper } = createStaffAccountsWrapper();
    const { result } = renderHook(
      () => useStaffAccounts({ onAccountCreated: vi.fn() }),
      { wrapper: Wrapper }
    );

    await expect(
      act(async () => {
        await result.current.createBranchMutation.mutateAsync({
          name: 'Lagos main',
        });
      })
    ).rejects.toThrow('Merchant not found');

    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.directInsert).not.toHaveBeenCalled();
  });

  it('reuses fresh staff and branch query results when the hook remounts', async () => {
    const { Wrapper } = createStaffAccountsWrapper();
    const callbacks = { onAccountCreated: vi.fn() };
    const firstRender = renderHook(() => useStaffAccounts(callbacks), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(firstRender.result.current.isLoading).toBe(false);
    });
    expect(mocks.supabaseFrom).toHaveBeenCalledTimes(2);
    firstRender.unmount();

    const secondRender = renderHook(() => useStaffAccounts(callbacks), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(secondRender.result.current.isLoading).toBe(false);
    });
    expect(mocks.supabaseFrom).toHaveBeenCalledTimes(2);
  });

  it('creates a staff account for the active merchant explicitly', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { Wrapper } = createStaffAccountsWrapper();
    const { result } = renderHook(
      () => useStaffAccounts({ onAccountCreated: vi.fn() }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await result.current.createAccountMutation.mutateAsync({
        name: 'Ada Till',
        staffId: '33333333-3333-4333-8333-333333333333',
      });
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://usebaci.com/api/paystack/virtual-terminal',
      expect.anything()
    );
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      destinations: [],
      merchantId: 'merchant-1',
      name: 'Ada Till',
      staffId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('rejects account creation before querying or fetching when no merchant is active', async () => {
    mocks.merchant = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { Wrapper } = createStaffAccountsWrapper();
    const { result } = renderHook(
      () => useStaffAccounts({ onAccountCreated: vi.fn() }),
      { wrapper: Wrapper }
    );

    await expect(
      act(async () => {
        await result.current.createAccountMutation.mutateAsync({
          name: 'Ada Till',
        });
      })
    ).rejects.toThrow(/^Merchant not found$/);

    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
