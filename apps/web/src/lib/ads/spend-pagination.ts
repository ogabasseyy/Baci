/**
 * Direct spend routes read daily rows from PostgREST. Keep each page below the
 * hosted API row cap and continue until a short page is observed so a full
 * first page can never be mistaken for a complete result.
 */
export const DIRECT_ADS_SPEND_PAGE_SIZE = 500;
const DIRECT_ADS_SPEND_MAX_PAGES = 1000;

interface SpendPage<Row> {
  data: Row[] | null;
  error: unknown;
}

export async function fetchPaginatedSpendRows<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<SpendPage<Row>>
): Promise<{ data: Row[]; error: unknown }> {
  const rows: Row[] = [];

  for (let page = 0; page < DIRECT_ADS_SPEND_MAX_PAGES; page += 1) {
    const from = page * DIRECT_ADS_SPEND_PAGE_SIZE;
    const to = from + DIRECT_ADS_SPEND_PAGE_SIZE - 1;
    const result = await fetchPage(from, to);
    if (result.error) return { data: [], error: result.error };

    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < DIRECT_ADS_SPEND_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }

  return {
    data: [],
    error: new Error('DIRECT_ADS_SPEND_PAGINATION_LIMIT'),
  };
}
