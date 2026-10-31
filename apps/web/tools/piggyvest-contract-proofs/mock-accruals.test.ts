import { describe, expect, it } from 'vitest';
import { accruedInterestReply } from './mock-accruals';
import { dataOf, type MockPagedData } from './mock-reply.test-support';
import { DEFAULT_MOCK_OPTIONS, type MockOptions } from './mock-sandbox-types';

const options = (over: Partial<MockOptions> = {}): MockOptions => ({
  ...DEFAULT_MOCK_OPTIONS,
  ...over,
});
const q = (params: Record<string, string> = {}) => new URLSearchParams(params);
const page = (
  over: Partial<MockOptions>,
  params: Record<string, string> = {}
) =>
  dataOf<MockPagedData>(accruedInterestReply(options(over), 'w1', q(params)))
    .paginatedPayload;

describe('accruedInterestReply', () => {
  it('has no records at the default and echoes the wallet and interest type', () => {
    expect(page({}).edges).toEqual([]);
    const [edge] = page(
      { accruedEdgeCount: 1 },
      { interest_type: 'differential' }
    ).edges;
    expect(edge).toMatchObject({
      wallet_id: 'w1',
      interest_type: 'differential',
      amount: 0,
    });
    expect(page({ accruedEdgeCount: 1 }).edges[0].interest_type).toBe(
      'original'
    );
  });

  it('serves the configured records page by page', () => {
    const first = page({ accruedEdgeCount: 3 }, { limit: '2' });
    expect(first.edges).toHaveLength(2);
    expect(first.pageInfo).toMatchObject({ hasNextPage: true, endCursor: '2' });
    const last = page({ accruedEdgeCount: 3 }, { limit: '2', cursor: '2' });
    expect(last.edges).toHaveLength(1);
    expect(last.pageInfo.hasNextPage).toBe(false);
  });

  it('gives every record its own id, and repeats ids under a rotating pager', () => {
    const ids = (over: Partial<MockOptions>, cursor?: string) =>
      page(
        { accruedEdgeCount: 4, ...over },
        { limit: '1', ...(cursor ? { cursor } : {}) }
      ).edges.map((edge) => edge.id);
    expect(ids({}, '0')).not.toEqual(ids({}, '1'));
    expect(ids({ pagingMode: 'rotating_cursor_same_rows' }, '0')).toEqual(
      ids({ pagingMode: 'rotating_cursor_same_rows' }, '1')
    );
  });

  it('refuses a page size outside 1 to 100', () => {
    for (const limit of ['0', '101', 'x']) {
      expect(accruedInterestReply(options(), 'w1', q({ limit })).status).toBe(
        400
      );
    }
  });
});
