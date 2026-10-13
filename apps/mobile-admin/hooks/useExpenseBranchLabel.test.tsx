import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExpenseBranchLabel } from './useExpenseBranchLabel';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mocks.from(...args) },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function historicalBranchQuery(response: unknown) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(response),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe('useExpenseBranchLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the active branch label without a historical lookup', () => {
    const query = historicalBranchQuery({ data: null, error: null });
    mocks.from.mockReturnValue(query);

    const { result } = renderHook(
      () =>
        useExpenseBranchLabel({
          branchId: 'branch-1',
          branches: [{ id: 'branch-1', name: 'Lagos main' }],
          branchesLoading: false,
          merchantId,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBe('Lagos main');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('resolves a historical branch after active branches finish loading', async () => {
    const query = historicalBranchQuery({
      data: { id: 'branch-1', name: 'Archived Lagos' },
      error: null,
    });
    mocks.from.mockReturnValue(query);

    const { result } = renderHook(
      () =>
        useExpenseBranchLabel({
          branchId: 'branch-1',
          branches: [],
          branchesLoading: false,
          merchantId,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current).toBe('Archived Lagos'));
    expect(query.select).toHaveBeenCalledWith('id, name');
    expect(query.eq).toHaveBeenCalledWith('merchant_id', merchantId);
  });

  it('keeps historical labels loading while the active branch query is pending', () => {
    const { result } = renderHook(
      () =>
        useExpenseBranchLabel({
          branchId: 'branch-1',
          branches: [],
          branchesLoading: true,
          merchantId,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBe('Loading branch...');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns the explicit unassigned label for expenses without a branch', () => {
    const { result } = renderHook(
      () =>
        useExpenseBranchLabel({
          branchId: null,
          branches: [],
          branchesLoading: false,
          merchantId,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBe('Unassigned');
  });

  it('falls back when a historical branch lookup fails', async () => {
    const query = historicalBranchQuery({
      data: null,
      error: new Error('lookup failed'),
    });
    mocks.from.mockReturnValue(query);
    const { result } = renderHook(
      () =>
        useExpenseBranchLabel({
          branchId: 'branch-1',
          branches: [],
          branchesLoading: false,
          merchantId,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current).toBe('Unknown branch'));
  });
});
