import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistFeedManifest } from './persist-feed-manifest';

interface Row {
  id: string;
  product_id: string;
  source_url: string;
}

function selectBuilder(pages: Array<{ data: Row[] | null; error: unknown }>) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'neq']) {
    builder[method] = () => builder;
  }
  builder['range'] = async () =>
    pages[Math.min(call++, pages.length - 1)] ?? { data: [], error: null };
  return builder;
}

function supabaseMock(options: {
  upsertErrors?: unknown[];
  selectPages?: Array<{ data: Row[] | null; error: unknown }>;
  staleError?: unknown;
}) {
  const upsertCalls: unknown[][] = [];
  const staleUpdates: unknown[][] = [];
  let upsertCall = 0;
  const client = {
    from: () => ({
      upsert: async (...args: unknown[]) => {
        upsertCalls.push(args);
        const error = options.upsertErrors?.[upsertCall++] ?? null;
        return { error };
      },
      select: () =>
        selectBuilder(options.selectPages ?? [{ data: [], error: null }]),
      update: (...args: unknown[]) => ({
        in: async (...inArgs: unknown[]) => {
          staleUpdates.push([args, inArgs]);
          return { error: options.staleError ?? null };
        },
      }),
    }),
  };
  return { client: client as never, upsertCalls, staleUpdates };
}

const row = (product_id: string, source_url: string) => ({
  merchant_id: 'm1',
  product_id,
  source_url,
});

describe('persistFeedManifest', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts rows and marks orphaned rows stale', async () => {
    const { client } = supabaseMock({
      selectPages: [
        {
          data: [
            { id: 'kept', product_id: 'p1', source_url: 'a.jpg' },
            { id: 'orphan', product_id: 'p1', source_url: 'old.jpg' },
          ],
          error: null,
        },
      ],
    });
    const result = await persistFeedManifest({
      supabase: client,
      merchantId: 'm1',
      upsertRows: [row('p1', 'a.jpg')],
      currentPairs: new Set(['p1::a.jpg']),
    });
    expect(result).toEqual({ upserted: 1, failedRows: 0, persistErrors: 0 });
  });

  it('retries failed batches and reports exhaustion', async () => {
    const { client } = supabaseMock({
      upsertErrors: [new Error('boom'), new Error('boom'), new Error('boom')],
      selectPages: [{ data: [], error: null }],
    });
    const result = await persistFeedManifest({
      supabase: client,
      merchantId: 'm1',
      upsertRows: [row('p1', 'a.jpg')],
      currentPairs: new Set(['p1::a.jpg']),
    });
    expect(result).toEqual({ upserted: 0, failedRows: 1, persistErrors: 1 });
  });

  it('recovers when a retry succeeds', async () => {
    const { client } = supabaseMock({
      upsertErrors: [new Error('flaky'), null],
      selectPages: [{ data: [], error: null }],
    });
    const result = await persistFeedManifest({
      supabase: client,
      merchantId: 'm1',
      upsertRows: [row('p1', 'a.jpg')],
      currentPairs: new Set(['p1::a.jpg']),
    });
    expect(result).toEqual({ upserted: 1, failedRows: 0, persistErrors: 0 });
  });

  it('counts stale-update and stale-fetch failures', async () => {
    const staleFailing = supabaseMock({
      selectPages: [
        {
          data: [{ id: 'orphan', product_id: 'p1', source_url: 'old.jpg' }],
          error: null,
        },
      ],
      staleError: new Error('stale write denied'),
    });
    const staleResult = await persistFeedManifest({
      supabase: staleFailing.client,
      merchantId: 'm1',
      upsertRows: [row('p1', 'a.jpg')],
      currentPairs: new Set(['p1::a.jpg']),
    });
    expect(staleResult.persistErrors).toBe(1);

    const fetchFailing = supabaseMock({
      selectPages: [{ data: null, error: new Error('select denied') }],
    });
    const fetchResult = await persistFeedManifest({
      supabase: fetchFailing.client,
      merchantId: 'm1',
      upsertRows: [row('p1', 'a.jpg')],
      currentPairs: new Set(['p1::a.jpg']),
    });
    expect(fetchResult.persistErrors).toBe(1);
  });
});
