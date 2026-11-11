import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVirtualTerminalSettings } from './use-virtual-terminal-settings';
import {
  createVirtualTerminalAccount,
  fetchVirtualTerminalData,
  VirtualTerminalRequestError,
} from './virtual-terminal-requests';

vi.mock('./virtual-terminal-requests', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./virtual-terminal-requests')>();
  return {
    ...actual,
    createVirtualTerminalAccount: vi.fn(),
    createVirtualTerminalBranch: vi.fn(),
    fetchVirtualTerminalData: vi.fn(),
  };
});
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: toastMock })),
}));

const merchantA = '11111111-1111-4111-8111-111111111111';
const merchantB = '22222222-2222-4222-8222-222222222222';
const toastMock = vi.hoisted(() => vi.fn());

describe('useVirtualTerminalSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps merchant B data when merchant A resolves after a switch', async () => {
    type TerminalData = Awaited<ReturnType<typeof fetchVirtualTerminalData>>;
    let resolveA: ((value: TerminalData) => void) | undefined;
    vi.mocked(fetchVirtualTerminalData)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          })
      )
      .mockResolvedValueOnce({
        accounts: { data: [{ id: 'terminal-b' } as never], error: null },
        branches: { data: [], error: null },
      });

    const { result, rerender } = renderHook(
      ({ merchantId }) =>
        useVirtualTerminalSettings({ businessName: 'Store', merchantId }),
      { initialProps: { merchantId: merchantA } }
    );

    rerender({ merchantId: merchantB });
    await waitFor(() => {
      expect(result.current.accounts).toEqual([{ id: 'terminal-b' }]);
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      resolveA?.({
        accounts: { data: [{ id: 'terminal-a' } as never], error: null },
        branches: { data: [], error: null },
      });
    });

    expect(result.current.accounts).toEqual([{ id: 'terminal-b' }]);
  });

  it('suppresses a late merchant A create completion after switching to B', async () => {
    let resolveCreate: (() => void) | undefined;
    vi.mocked(fetchVirtualTerminalData).mockResolvedValue({
      accounts: { data: [], error: null },
      branches: { data: [], error: null },
    } as never);
    vi.mocked(createVirtualTerminalAccount).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ merchantId }) =>
        useVirtualTerminalSettings({ businessName: 'Store', merchantId }),
      { initialProps: { merchantId: merchantA } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() =>
      result.current.setNewAccount((value) => ({ ...value, name: 'Till' }))
    );
    let createPromise: Promise<void> | undefined;
    act(() => {
      createPromise = result.current.handleCreateAccount();
    });

    rerender({ merchantId: merchantB });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      resolveCreate?.();
      await createPromise;
    });

    expect(result.current.creating).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('keeps prior branches while applying refreshed accounts after branch loading fails', async () => {
    vi.mocked(fetchVirtualTerminalData)
      .mockResolvedValueOnce({
        accounts: { data: [{ id: 'terminal-before' } as never], error: null },
        branches: { data: [{ id: 'branch-before' } as never], error: null },
      } as never)
      .mockResolvedValueOnce({
        accounts: { data: [{ id: 'terminal-after' } as never], error: null },
        branches: {
          data: null,
          error: new VirtualTerminalRequestError(
            'Unable to fetch branch data. Please refresh the page.',
            'branches'
          ),
        },
      } as never);
    vi.mocked(createVirtualTerminalAccount).mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useVirtualTerminalSettings({
        businessName: 'Store',
        merchantId: merchantA,
      })
    );
    await waitFor(() =>
      expect(result.current.branches).toEqual([{ id: 'branch-before' }])
    );
    act(() =>
      result.current.setNewAccount((value) => ({ ...value, name: 'Till' }))
    );

    await act(async () => {
      await result.current.handleCreateAccount();
    });

    expect(result.current.accounts).toEqual([{ id: 'terminal-after' }]);
    expect(result.current.branches).toEqual([{ id: 'branch-before' }]);
    expect(toastMock).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Failed to load branches',
      description: 'Unable to fetch branch data. Please refresh the page.',
    });
  });

  it('keeps prior accounts while applying refreshed branches after account loading fails', async () => {
    vi.mocked(fetchVirtualTerminalData)
      .mockResolvedValueOnce({
        accounts: { data: [{ id: 'terminal-before' } as never], error: null },
        branches: { data: [{ id: 'branch-before' } as never], error: null },
      } as never)
      .mockResolvedValueOnce({
        accounts: {
          data: null,
          error: new VirtualTerminalRequestError(
            'Unable to fetch staff accounts. Please refresh the page.',
            'accounts'
          ),
        },
        branches: { data: [{ id: 'branch-after' } as never], error: null },
      } as never);
    vi.mocked(createVirtualTerminalAccount).mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useVirtualTerminalSettings({
        businessName: 'Store',
        merchantId: merchantA,
      })
    );
    await waitFor(() =>
      expect(result.current.accounts).toEqual([{ id: 'terminal-before' }])
    );
    act(() =>
      result.current.setNewAccount((value) => ({ ...value, name: 'Till' }))
    );

    await act(async () => {
      await result.current.handleCreateAccount();
    });

    expect(result.current.accounts).toEqual([{ id: 'terminal-before' }]);
    expect(result.current.branches).toEqual([{ id: 'branch-after' }]);
    expect(toastMock).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Failed to load accounts',
      description: 'Unable to fetch staff accounts. Please refresh the page.',
    });
  });
});
