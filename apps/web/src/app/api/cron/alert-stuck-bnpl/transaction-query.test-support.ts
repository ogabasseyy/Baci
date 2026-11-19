interface LookupResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

const legacyFixtureIds = new WeakMap<object, string>();
let nextFixtureId = 0;

function fixtureId(row: Record<string, unknown>, cursor: string | undefined) {
  if (typeof row.id === 'string') return row.id;
  const existing = legacyFixtureIds.get(row);
  if (existing) return existing;
  if (cursor)
    throw new Error(
      'Paginated fixture rows must retain object identity or provide explicit IDs'
    );
  const id = `fixture-${String(nextFixtureId++).padStart(6, '0')}`;
  legacyFixtureIds.set(row, id);
  return id;
}

/** Models API row caps and ID keyset filters without changing existing fixtures. */
export function createTransactionQueryMock(
  fetch: (column: string, values: string[]) => Promise<LookupResult>,
  serverPageSize = 1000,
  onCursor?: (column: string, cursor: string) => void
) {
  let response: Promise<LookupResult> = Promise.resolve({
    data: [],
    error: null,
  });
  let cursor: string | undefined;
  let limit = serverPageSize;
  let projection = new Set<string>();
  let ascendingId = false;
  return {
    select(columns: string) {
      projection = new Set(columns.split(',').map((column) => column.trim()));
      return this;
    },
    in(column: string, values: string[]) {
      if (column === 'order_id') response = fetch(column, values);
      return this;
    },
    order(column: string, options: { ascending: boolean }) {
      if (column !== 'id' || options.ascending !== true)
        throw new Error('Transaction pagination requires ascending ID order');
      ascendingId = true;
      return this;
    },
    limit(value: number) {
      limit = Math.min(value, serverPageSize);
      return this;
    },
    gt(column: string, value: string) {
      if (column !== 'id')
        throw new Error('Transaction pagination supports only ID cursors');
      cursor = value;
      onCursor?.(column, value);
      return this;
    },
    // biome-ignore lint/suspicious/noThenProperty: PostgREST query builders are deliberately thenable.
    then(
      resolve: (result: LookupResult) => unknown,
      reject?: (reason: unknown) => unknown
    ): Promise<unknown> {
      if (!ascendingId)
        throw new Error('Transaction pagination requires ascending ID order');
      return response
        .then((result) => ({
          ...result,
          data:
            result.data
              ?.map((row) => ({ ...row, id: fixtureId(row, cursor) }))
              .filter((row) => !cursor || row.id > cursor)
              .sort((left, right) =>
                left.id < right.id ? -1 : left.id > right.id ? 1 : 0
              )
              .slice(0, limit)
              .map((row) =>
                Object.fromEntries(
                  Object.entries(row).filter(([column]) =>
                    projection.has(column)
                  )
                )
              ) ?? null,
        }))
        .then(resolve, reject);
    },
  };
}
