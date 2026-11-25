export const MERCHANT = '11111111-1111-4111-8111-111111111111';
export const A = '33333333-3333-4333-8333-33333333333a';
export const B = '33333333-3333-4333-8333-33333333333b';

/** Fake query builder: records filters, answers per table. */
export function db(
  answers: Record<string, { data: unknown; error?: unknown }>
) {
  const seen: { table: string; filters: unknown[][] }[] = [];
  return {
    seen,
    client: {
      from: (table: string) => {
        const entry = { table, filters: [] as unknown[][] };
        seen.push(entry);
        const result = () =>
          Promise.resolve({ error: null, ...answers[table] });
        const builder: Record<string, unknown> = { maybeSingle: result };
        for (const name of [
          'select',
          'eq',
          'in',
          'is',
          'order',
          'limit',
          'abortSignal',
        ]) {
          builder[name] = (...args: unknown[]) => {
            entry.filters.push([name, ...args]);
            // The last call of a chain may be awaited directly, so those
            // return a real promise that still offers the rest of the chain.
            return name === 'is' || name === 'limit' || name === 'abortSignal'
              ? Object.assign(result(), builder)
              : builder;
          };
        }
        return builder;
      },
    } as never,
  };
}
