import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  gte: vi.fn(),
  gt: vi.fn(),
  in: vi.fn(),
  is: vi.fn(),
  limit: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  returns: vi.fn(),
  select: vi.fn(),
}));

const query = {
  eq: mocks.eq,
  gte: mocks.gte,
  gt: mocks.gt,
  in: mocks.in,
  is: mocks.is,
  limit: mocks.limit,
  lte: mocks.lte,
  or: mocks.or,
  order: mocks.order,
  range: mocks.range,
  returns: mocks.returns,
  select: mocks.select,
};

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.in.mockReturnValue(query);
  mocks.is.mockReturnValue(query);
  mocks.order.mockReturnValue(query);
  mocks.or.mockReturnValue(query);
  mocks.gte.mockReturnValue(query);
  mocks.gt.mockReturnValue(query);
  mocks.lte.mockReturnValue(query);
  mocks.limit.mockReturnValue({ returns: mocks.returns });
  mocks.range.mockReturnValue({ returns: mocks.returns });
  mocks.returns.mockResolvedValue({ data: [], error: null });
});

it('caps the legacy scan and reports truncation instead of paging forever', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  // Eleven full pages: the eleventh must never be requested.
  for (let page = 0; page < 11; page += 1) {
    mocks.returns.mockResolvedValueOnce({
      data: Array.from({ length: 200 }, (_, index) => ({
        created_at: '2025-01-01T00:00:00Z',
        id: `p${page}-${String(index).padStart(3, '0')}`,
      })),
      error: null,
    });
  }
  const result = await fetchTransactionReviewRows({
    includeCancelledAt: true,
    includeTransactionDate: false,
    merchantId: 'merchant-1',
    fetchAll: true,
    selectStatement: 'id',
  });
  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(2000);
  expect(result.truncated).toBe(true);
  expect(mocks.returns).toHaveBeenCalledTimes(10);
});

it('returns an error rather than incomplete searchable history when a later page fails', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  const error = { message: 'Network error' };
  mocks.returns
    .mockResolvedValueOnce({
      data: Array.from({ length: 200 }, () => ({ id: 'row' })),
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error });
  const result = await fetchTransactionReviewRows({
    includeCancelledAt: true,
    includeTransactionDate: false,
    merchantId: 'merchant-1',
    fetchAll: true,
    selectStatement: 'id',
  });
  expect(result.error).toEqual(error);
  expect(result.data).toBeNull();
});

it('scans undated legacy rows alongside the dated stream', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  mocks.returns
    .mockResolvedValueOnce({
      data: [
        {
          created_at: '2026-10-06T00:00:00Z',
          id: 'dated-row',
          transaction_date: '2026-10-06T00:00:00Z',
        },
      ],
      error: null,
    })
    .mockResolvedValueOnce({
      data: Array.from({ length: 200 }, (_, index) => ({
        created_at: '2024-01-01T00:00:00Z',
        id: `legacy-${String(index).padStart(3, '0')}`,
        transaction_date: null,
      })),
      error: null,
    })
    .mockResolvedValueOnce({
      data: [
        {
          created_at: '2023-01-01T00:00:00Z',
          id: 'legacy-last',
          transaction_date: null,
        },
      ],
      error: null,
    });

  const result = await fetchTransactionReviewRows({
    fetchAll: true,
    includeCancelledAt: true,
    includeTransactionDate: true,
    merchantId: 'merchant-1',
    selectStatement: 'id',
  });

  expect(result.error).toBeNull();
  expect(result.truncated).toBe(false);
  expect(result.data).toHaveLength(202);
  expect(mocks.or).toHaveBeenCalledWith(
    expect.stringContaining('or(transaction_date.is.null)')
  );
  // The undated stream pages by (created_at, id): no transaction-date cursor.
  const undatedCursorCall = mocks.or.mock.calls.find((call) =>
    String(call[0]).includes('created_at.lt.')
  );
  expect(String(undatedCursorCall?.[0] ?? '')).toContain(
    'transaction_date.is.null'
  );
  expect(String(undatedCursorCall?.[0] ?? '')).not.toContain(
    'transaction_date.lt.'
  );
  expect(result.data?.map((row) => row.id)).toContain('legacy-last');
});

it('keeps the newest undated rows when dated rows alone exceed the scan cap', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  // Nine-plus full dated pages (effective 2026-01-01) plus one full undated
  // page (effective 2026-10-01): the merged scan must keep all 200 undated
  // rows ahead of the oldest dated rows instead of capping inside the dated
  // set. The mock serves fixtures by the phase filter on each call, like the
  // server would: a dated-first scan never reaches the undated fixture.
  const datedPage = (page: number) => ({
    data: Array.from({ length: 200 }, (_, index) => ({
      created_at: '2026-01-02T00:00:00Z',
      id: `old-dated-p${page}-${String(index).padStart(3, '0')}`,
      transaction_date: '2026-01-01T00:00:00Z',
    })),
    error: null,
  });
  const undatedPage = {
    data: Array.from({ length: 200 }, (_, index) => ({
      created_at: '2026-10-01T00:00:00Z',
      id: `new-undated-${String(index).padStart(3, '0')}`,
      transaction_date: null,
    })),
    error: null,
  };
  const emptyPage = { data: [], error: null };
  const orFilters: string[] = [];
  mocks.or.mockImplementation((filter: string) => {
    orFilters.push(filter);
    return query;
  });
  let datedCalls = 0;
  let undatedCalls = 0;
  mocks.returns.mockImplementation(() => {
    const filter = orFilters[orFilters.length - 1] ?? '';
    if (filter.includes('or(transaction_date.is.null)')) {
      undatedCalls += 1;
      return Promise.resolve(undatedCalls === 1 ? undatedPage : emptyPage);
    }
    datedCalls += 1;
    return Promise.resolve(
      datedCalls <= 10 ? datedPage(datedCalls) : emptyPage
    );
  });

  const result = await fetchTransactionReviewRows({
    fetchAll: true,
    includeCancelledAt: true,
    includeTransactionDate: true,
    merchantId: 'merchant-1',
    selectStatement: 'id',
  });

  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(2000);
  expect(result.truncated).toBe(true);
  const ids = result.data?.map((row) => row.id) ?? [];
  expect(ids.slice(0, 200).every((id) => id.startsWith('new-undated-'))).toBe(
    true
  );
  expect(mocks.returns).toHaveBeenCalledTimes(11);
});
