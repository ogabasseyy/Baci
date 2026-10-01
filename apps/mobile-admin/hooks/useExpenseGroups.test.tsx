import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExpenseGroups } from './useExpenseGroups';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const activeGroup = {
  archived_at: null,
  created_at: '2026-08-09T12:00:00.000Z',
  id: '02f07db2-10e9-4c60-a0df-a4f5ccba9d9d',
  merchant_id: merchantId,
  name: 'Operations',
  updated_at: '2026-08-09T12:00:00.000Z',
};
const archivedGroup = {
  ...activeGroup,
  archived_at: '2026-08-10T12:00:00.000Z',
  id: '2f810d8f-1247-4a6d-8f49-33c1eeb0d61a',
  name: 'Closed project',
};
const groupColumns =
  'id, merchant_id, name, archived_at, created_at, updated_at';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  merchant: { id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e' } as {
    id: string;
  } | null,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => mocks.from(table) },
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function listQuery(rows: unknown[]) {
  const query = {
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.order.mockResolvedValue({ data: rows, error: null });

  return { select: vi.fn(() => query), query };
}

function singleInsert(response: unknown) {
  const single = vi.fn().mockResolvedValue(response);
  const select = vi.fn(() => ({ single }));
  return { insert: vi.fn(() => ({ select })), select };
}

function singleUpdate(response: unknown) {
  const single = vi.fn().mockResolvedValue(response);
  const select = vi.fn(() => ({ single }));
  const query = { eq: vi.fn(), select };
  query.eq.mockReturnValue(query);
  return { query, update: vi.fn(() => query) };
}

describe('useExpenseGroups', () => {
  beforeEach(() => {
    mocks.merchant = { id: merchantId };
    mocks.from.mockReset();
  });

  it('loads active and historical groups with explicit merchant-scoped queries', async () => {
    const all = listQuery([activeGroup, archivedGroup]);
    mocks.from.mockReturnValueOnce({ ...all });
    const { result } = renderHook(() => useExpenseGroups(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.activeGroups).toEqual([activeGroup]);
    expect(result.current.allGroups).toEqual([activeGroup, archivedGroup]);
    expect(mocks.from).toHaveBeenCalledWith('expense_groups');
    expect(all.select).toHaveBeenCalledWith(groupColumns);
    expect(all.query.eq).toHaveBeenCalledWith('merchant_id', merchantId);
    expect(all.query.is).not.toHaveBeenCalled();
  });

  it('trims group names, scopes each write to the merchant, and refreshes group queries', async () => {
    const all = listQuery([activeGroup]);
    mocks.from.mockReturnValueOnce(all);
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useExpenseGroups(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mocks.from.mockClear();

    const create = singleInsert({ data: activeGroup, error: null });
    const rename = singleUpdate({
      data: { ...activeGroup, name: 'Team operations' },
      error: null,
    });
    const archive = singleUpdate({
      data: { ...activeGroup, archived_at: '2026-08-11T12:00:00.000Z' },
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(create)
      .mockReturnValueOnce(listQuery([activeGroup]))
      .mockReturnValueOnce(rename)
      .mockReturnValueOnce(listQuery([activeGroup]))
      .mockReturnValueOnce(archive)
      .mockReturnValueOnce(listQuery([activeGroup]));

    await act(async () => {
      await result.current.createGroup('  Operations  ');
    });
    await act(async () => {
      await result.current.renameGroup(activeGroup.id, ' Team operations ');
    });
    await act(async () => {
      await result.current.archiveGroup(activeGroup.id);
    });

    expect(create.insert).toHaveBeenCalledWith({
      merchant_id: merchantId,
      name: 'Operations',
    });
    expect(create.select).toHaveBeenCalledWith(groupColumns);
    expect(rename.update).toHaveBeenCalledWith({ name: 'Team operations' });
    expect(rename.query.eq).toHaveBeenNthCalledWith(1, 'id', activeGroup.id);
    expect(rename.query.eq).toHaveBeenNthCalledWith(
      2,
      'merchant_id',
      merchantId
    );
    expect(archive.update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) })
    );
    expect(archive.query.eq).toHaveBeenNthCalledWith(1, 'id', activeGroup.id);
    expect(archive.query.eq).toHaveBeenNthCalledWith(
      2,
      'merchant_id',
      merchantId
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['expense-groups', merchantId],
    });
  });

  it('uses a clear duplicate-name error when the active-name constraint rejects a write', async () => {
    const all = listQuery([activeGroup]);
    mocks.from.mockReturnValueOnce(all);
    const { result } = renderHook(() => useExpenseGroups(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const create = singleInsert({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    });
    mocks.from.mockReturnValue(create);

    await expect(result.current.createGroup('Operations')).rejects.toThrow(
      'An active expense group with this name already exists.'
    );
  });

  it('does not retry a create after an ambiguous insert failure', async () => {
    const all = listQuery([activeGroup]);
    mocks.from.mockReturnValueOnce(all);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: 1 }, queries: { retry: false } },
    });
    const { result } = renderHook(() => useExpenseGroups(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const create = singleInsert({
      data: null,
      error: { message: 'network response lost' },
    });
    mocks.from.mockReturnValue(create);

    await expect(result.current.createGroup('Operations')).rejects.toThrow(
      'network response lost'
    );
    expect(create.insert).toHaveBeenCalledOnce();
  });

  it('fails closed when no merchant is available for a group mutation', async () => {
    mocks.merchant = null;
    const { result } = renderHook(() => useExpenseGroups(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await expect(result.current.createGroup('Operations')).rejects.toThrow(
      'No active merchant'
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects malformed group ids before a rename or archive reaches the database', async () => {
    const all = listQuery([activeGroup]);
    mocks.from.mockReturnValueOnce(all);
    const { result } = renderHook(() => useExpenseGroups(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mocks.from.mockClear();

    await expect(
      result.current.renameGroup('not-a-group-id', 'Operations')
    ).rejects.toThrow();
    await expect(
      result.current.archiveGroup('not-a-group-id')
    ).rejects.toThrow();

    expect(mocks.from).not.toHaveBeenCalled();
  });
});
