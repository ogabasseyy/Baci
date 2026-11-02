import { jest } from '@jest/globals';

export type ProductRow = Record<string, unknown>;
type QueryFilter = (row: ProductRow) => boolean;
export type QueryOperation = { args: unknown[]; method: string };

export let fixtureRows: ProductRow[] = [];
export const mockOperations: QueryOperation[] = [];
export const mockRpc =
  jest.fn<
    (...args: unknown[]) => Promise<{
      data: unknown;
      error: unknown;
    }>
  >();

function mockCreateQuery() {
  const filters: QueryFilter[] = [];
  const orders: Array<{ ascending: boolean; field: string }> = [];
  let head = false;
  let limit: number | null = null;
  let range: [number, number] | null = null;

  const query = {
    eq: jest.fn((field: string, value: unknown) => {
      mockOperations.push({ method: 'eq', args: [field, value] });
      filters.push((row) => row[field] === value);
      return query;
    }),
    gt: jest.fn((field: string, value: string) => {
      mockOperations.push({ method: 'gt', args: [field, value] });
      filters.push((row) => String(row[field] ?? '') > value);
      return query;
    }),
    gte: jest.fn((field: string, value: number) => {
      mockOperations.push({ method: 'gte', args: [field, value] });
      filters.push((row) => Number(row[field]) >= value);
      return query;
    }),
    ilike: jest.fn((field: string, pattern: string) => {
      mockOperations.push({ method: 'ilike', args: [field, pattern] });
      const needle = pattern.replace(/^%|%$/g, '').toLowerCase();
      filters.push((row) =>
        String(row[field] ?? '')
          .toLowerCase()
          .includes(needle)
      );
      return query;
    }),
    in: jest.fn((field: string, values: string[]) => {
      mockOperations.push({ method: 'in', args: [field, values] });
      filters.push((row) => values.includes(String(row[field] ?? '')));
      return query;
    }),
    limit: jest.fn((value: number) => {
      mockOperations.push({ method: 'limit', args: [value] });
      limit = value;
      return query;
    }),
    lte: jest.fn((field: string, value: number) => {
      mockOperations.push({ method: 'lte', args: [field, value] });
      filters.push((row) => Number(row[field]) <= value);
      return query;
    }),
    or: jest.fn((expression: string) => {
      mockOperations.push({ method: 'or', args: [expression] });
      const scalarConditions = expression
        .match(/^condition\.in\.\(([^)]+)\)/)?.[1]
        ?.split(',');
      const arrayFilter = expression.match(
        /available_conditions\.(cs|ov)\.\{([^}]+)\}/
      );
      const arrayOperator = arrayFilter?.[1];
      const arrayConditions = arrayFilter?.[2]?.split(',');
      if (scalarConditions && arrayOperator && arrayConditions) {
        filters.push((row) => {
          const values = row.available_conditions;
          const matchesArray =
            Array.isArray(values) &&
            (arrayOperator === 'cs'
              ? arrayConditions.every((value) => values.includes(value))
              : arrayConditions.some((value) => values.includes(value)));
          return (
            scalarConditions.includes(String(row.condition ?? '')) ||
            matchesArray
          );
        });
      }
      return query;
    }),
    order: jest.fn((field: string, options: { ascending: boolean }) => {
      mockOperations.push({ method: 'order', args: [field, options] });
      orders.push({ field, ascending: options.ascending });
      return query;
    }),
    range: jest.fn((from: number, to: number) => {
      mockOperations.push({ method: 'range', args: [from, to] });
      range = [from, to];
      return query;
    }),
    select: jest.fn(
      (_columns: string, options?: { count?: string; head?: boolean }) => {
        mockOperations.push({ method: 'select', args: [_columns, options] });
        head = options?.head === true;
        return query;
      }
    ),
    // biome-ignore lint/suspicious/noThenProperty: PostgREST query builders are awaitable thenables.
    then: (
      resolve: (value: {
        count: number;
        data: ProductRow[] | null;
        error: null;
      }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      let rows = fixtureRows.filter((row) =>
        filters.every((matches) => matches(row))
      );
      rows = [...rows].sort((left, right) => {
        for (const { field, ascending } of orders) {
          const a = left[field];
          const b = right[field];
          const compared =
            typeof a === 'number' && typeof b === 'number'
              ? a - b
              : String(a ?? '').localeCompare(String(b ?? ''));
          if (compared !== 0) return ascending ? compared : -compared;
        }
        return 0;
      });
      const count = rows.length;
      if (head) rows = [];
      else if (limit !== null) rows = rows.slice(0, limit);
      else if (range) rows = rows.slice(range[0], range[1] + 1);
      return Promise.resolve({
        count,
        data: head ? null : rows,
        error: null,
      }).then(resolve, reject);
    },
  };
  return query;
}

export const mockFrom = jest.fn<
  (...args: unknown[]) => ReturnType<typeof mockCreateQuery>
>((..._args) => mockCreateQuery());

export function resetSandboxQueryMocks() {
  jest.clearAllMocks();
  mockOperations.length = 0;
  fixtureRows = [];
  mockRpc.mockResolvedValue({ data: [], error: null });
}

export function setSandboxFixtureRows(rows: ProductRow[]) {
  fixtureRows = rows;
}
