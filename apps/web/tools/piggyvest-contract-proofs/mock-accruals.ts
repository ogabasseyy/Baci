import { pageWindow } from './mock-paging';
import {
  fail,
  type MockOptions,
  type MockReply,
  ok,
  ulid,
} from './mock-sandbox-types';

/** The accrued-interest list: `accruedEdgeCount` zero-amount records, paged by cursor. */
export function accruedInterestReply(
  options: MockOptions,
  walletId: string,
  query: URLSearchParams
): MockReply {
  const limit = Number(query.get('limit') ?? 31);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail('limit must be between 1 and 100');
  }
  const total = options.accruedEdgeCount;
  const window = pageWindow(
    options.pagingMode,
    query.get('cursor'),
    limit,
    total
  );
  const { start } = window;
  const count = window.end - window.start;
  const edges = Array.from({ length: count }, (_, index) => ({
    id: ulid('i', start + index),
    business_id: 'business-00000001',
    wallet_id: walletId,
    wallet_name: 'Default Wallet',
    amount: 0,
    balance: 0,
    percentage: 0,
    interest_date: '2026-10-01',
    interest_date_timestamp: `2026-10-01T00:00:${String(start + index).padStart(2, '0')}.000Z`,
    interest_type: query.get('interest_type') ?? 'original',
    differential_wallet_id: null,
    differential_wallet_name: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }));
  // The live accrual page info has no previousCursor (staging, 2026-10-31),
  // unlike the transaction list.
  return ok({
    paginatedPayload: {
      edges,
      pageInfo: {
        hasNextPage: window.hasNextPage,
        endCursor: window.endCursor,
      },
    },
  });
}
