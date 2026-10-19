import { describe, expect, it, vi } from 'vitest';
import {
  DIRECT_ADS_SPEND_PAGE_SIZE,
  fetchPaginatedSpendRows,
} from './spend-pagination';

describe('fetchPaginatedSpendRows', () => {
  it('does not truncate a full page followed by another page', async () => {
    const firstPage = Array.from(
      { length: DIRECT_ADS_SPEND_PAGE_SIZE },
      (_, index) => index
    );
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [DIRECT_ADS_SPEND_PAGE_SIZE],
        error: null,
      });

    const result = await fetchPaginatedSpendRows(fetchPage);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(DIRECT_ADS_SPEND_PAGE_SIZE + 1);
    expect(fetchPage).toHaveBeenNthCalledWith(
      1,
      0,
      DIRECT_ADS_SPEND_PAGE_SIZE - 1
    );
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      DIRECT_ADS_SPEND_PAGE_SIZE,
      DIRECT_ADS_SPEND_PAGE_SIZE * 2 - 1
    );
  });

  it('returns provider errors without exposing a partial row prefix', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('query failed'),
    });

    const result = await fetchPaginatedSpendRows(fetchPage);

    expect(result.data).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });
});
