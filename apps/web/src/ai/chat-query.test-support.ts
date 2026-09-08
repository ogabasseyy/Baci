import { vi } from 'vitest';

type QueryResult = {
  data: unknown;
  error?: unknown;
  count?: number | null;
};

export function createQueryMock(
  result: QueryResult = { data: null, error: null }
) {
  const query = Object.assign(Promise.resolve(result), {
    select: vi.fn<(...args: unknown[]) => unknown>(),
    eq: vi.fn<(...args: unknown[]) => unknown>(),
    or: vi.fn<(...args: unknown[]) => unknown>(),
    ilike: vi.fn<(...args: unknown[]) => unknown>(),
    neq: vi.fn<(...args: unknown[]) => unknown>(),
    gt: vi.fn<(...args: unknown[]) => unknown>(),
    gte: vi.fn<(...args: unknown[]) => unknown>(),
    lt: vi.fn<(...args: unknown[]) => unknown>(),
    lte: vi.fn<(...args: unknown[]) => unknown>(),
    in: vi.fn<(...args: unknown[]) => unknown>(),
    order: vi.fn<(...args: unknown[]) => unknown>(),
    limit: vi.fn<(...args: unknown[]) => unknown>(),
    single: vi.fn<() => Promise<QueryResult>>(),
    maybeSingle: vi.fn<() => Promise<QueryResult>>(),
  });

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.lt.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.single.mockResolvedValue(result);
  query.maybeSingle.mockResolvedValue(result);

  return query;
}
