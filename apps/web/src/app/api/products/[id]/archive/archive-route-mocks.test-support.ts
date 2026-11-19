import { vi } from 'vitest';

export interface ArchiveSupabaseMockState {
  archiveError: { code?: string; message?: string } | null;
  archiveResult: unknown;
  filters: [string, unknown][];
  merchantError: { message?: string } | null;
  merchantSlugRow: { slug: string | null } | null;
  merchantThrows: boolean;
  selectArgs: string[];
  updatePayload: unknown;
}

export function createArchiveSupabaseMock(mocks: ArchiveSupabaseMockState) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        const merchantQuery = {
          select: vi.fn(() => merchantQuery),
          eq: vi.fn(() => merchantQuery),
          single: vi.fn(() => {
            if (mocks.merchantThrows) {
              return Promise.reject(new Error('merchant read failed'));
            }
            return Promise.resolve({
              data: mocks.merchantError ? null : mocks.merchantSlugRow,
              error: mocks.merchantError,
            });
          }),
        };
        return merchantQuery;
      }

      const query = {
        eq: vi.fn((column: string, value: unknown) => {
          mocks.filters.push([column, value]);
          return query;
        }),
        select: vi.fn((arg?: string) => {
          if (typeof arg === 'string') mocks.selectArgs.push(arg);
          return {
            single: vi.fn(() =>
              Promise.resolve({
                data: mocks.archiveError ? null : mocks.archiveResult,
                error: mocks.archiveError,
              })
            ),
          };
        }),
      };
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        })),
        update: vi.fn((payload: unknown) => {
          mocks.updatePayload = payload;
          return query;
        }),
      };
    }),
  };
}
