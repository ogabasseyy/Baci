import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAnalyticsCategoryData } from './fetch-analytics-category-data';

const merchantId = 'merchant-1';
const from = new Date('2026-08-01T12:34:56.000Z');
const to = new Date('2026-08-22T18:45:00.000Z');

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

describe('fetchAnalyticsCategoryData Ads order window', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extends the selected order window through the local end date while retaining provider calendar dates', async () => {
    fetchMock.mockResolvedValue(response({}));

    await fetchAnalyticsCategoryData({
      category: 'ads',
      from,
      merchantId,
      signal: new AbortController().signal,
      to,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('startDate=2026-08-01');
    expect(String(url)).toContain('endDate=2026-08-22');
    expect(String(url)).toContain(
      `orderStart=${encodeURIComponent(from.toISOString())}`
    );
    const expectedOrderEnd = new Date(to);
    expectedOrderEnd.setHours(23, 59, 59, 999);
    expect(String(url)).toContain(
      `orderEnd=${encodeURIComponent(expectedOrderEnd.toISOString())}`
    );
    expect(init).toEqual(
      expect.objectContaining({
        headers: { 'x-baci-merchant-id': merchantId },
      })
    );
  });
});
