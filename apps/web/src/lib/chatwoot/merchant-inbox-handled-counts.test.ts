import { afterEach, describe, expect, it, vi } from 'vitest';
import { binding, stubFetch } from './merchant-inbox-client.test-support';
import { getHandledCounts } from './merchant-inbox-handled-counts';

afterEach(() => vi.unstubAllGlobals());

const NOW = Date.UTC(2026, 10, 19, 12);

describe('getHandledCounts', () => {
  it('counts each label inside the bound inbox and the window', async () => {
    const fetchMock = stubFetch((_url, init) => {
      const label = JSON.parse(String(init?.body)).payload[1].values[0];
      return {
        body: { meta: { all_count: label === 'handled-by-ai' ? 8 : 2 } },
      };
    });
    const counts = await getHandledCounts(binding, { days: 7, now: NOW });

    expect(counts).toEqual({ handledByAi: 8, handledByMerchant: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(
      '/api/v1/accounts/2/conversations/filter'
    );
    const { payload } = JSON.parse(String((init as RequestInit).body));
    expect(payload[0]).toMatchObject({
      attribute_key: 'inbox_id',
      values: [20],
    });
    expect(payload[2]).toMatchObject({
      attribute_key: 'created_at',
      values: ['2026-11-11'],
      query_operator: null,
    });
  });

  it('reports an unreadable count as null, never as zero', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch((_url, init) =>
      JSON.parse(String(init?.body)).payload[1].values[0] === 'handled-by-ai'
        ? { status: 500 }
        : { body: { meta: { all_count: 'many' } } }
    );
    expect(await getHandledCounts(binding, { days: 30, now: NOW })).toEqual({
      handledByAi: null,
      handledByMerchant: null,
    });
  });

  it('reports null when the provider is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => new Error('down'));
    expect(await getHandledCounts(binding, { days: 7, now: NOW })).toEqual({
      handledByAi: null,
      handledByMerchant: null,
    });
  });
});
