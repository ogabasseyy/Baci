import { vi } from 'vitest';

/** Supabase-like builder for pre-mutation reads and mutation returning selects. */
export function createBulkUpdateRouteQueryBuilder(
  getError: () => unknown,
  getRows: () => unknown[] = () => []
) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.limit = vi.fn(() =>
    Promise.resolve({ data: getRows(), error: getError() })
  );
  builder.select = vi.fn(() =>
    Promise.resolve({ data: getRows(), error: getError() })
  );
  // biome-ignore lint/suspicious/noThenProperty: Supabase builders are thenable.
  builder.then = vi.fn(
    (resolve: (value: { data: unknown[]; error: unknown }) => void) =>
      resolve({ data: getRows(), error: getError() })
  );
  return builder;
}
