import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type LoyaltyStateHandlers,
  loadLoyaltyData,
} from './loyalty-data-client';

function handlers(): LoyaltyStateHandlers & {
  calls: { data: unknown[]; loading: boolean[]; error: unknown[] };
} {
  const calls: { data: unknown[]; loading: boolean[]; error: unknown[] } = {
    data: [],
    loading: [],
    error: [],
  };
  return {
    calls,
    setData: (data) => {
      calls.data.push(data);
    },
    setLoading: (loading) => {
      calls.loading.push(loading);
    },
    setError: (error) => {
      calls.error.push(error);
    },
  };
}

describe('loadLoyaltyData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears state without fetching when ids are missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const missingMerchant = handlers();
    await loadLoyaltyData(undefined, 'c', missingMerchant);
    const missingCustomer = handlers();
    await loadLoyaltyData('m', undefined, missingCustomer);

    expect(fetchSpy).not.toHaveBeenCalled();
    for (const h of [missingMerchant, missingCustomer]) {
      expect(h.calls.data).toEqual([null]);
      expect(h.calls.error).toEqual([null]);
      expect(h.calls.loading).toEqual([false]);
    }
  });

  it('serves preview data without fetching for preview merchants', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const dashPreview = handlers();
    await loadLoyaltyData('acme-preview', 'c', dashPreview);
    const demo = handlers();
    await loadLoyaltyData('demo-store', 'c', demo);

    expect(fetchSpy).not.toHaveBeenCalled();
    for (const h of [dashPreview, demo]) {
      expect(h.calls.data).toHaveLength(1);
      expect(h.calls.data[0]).toMatchObject({
        enrolled: true,
        referral_code: 'PREVIEW1',
      });
      expect(h.calls.error).toEqual([null]);
      expect(h.calls.loading).toEqual([false]);
    }
  });

  it('clears data without an error on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const h = handlers();
    await loadLoyaltyData('m', 'c', h);

    expect(h.calls.data).toEqual([null]);
    expect(h.calls.error).toEqual([null]);
    expect(h.calls.loading).toEqual([true, false]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports non-404 failures and clears data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }))
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const h = handlers();
    await loadLoyaltyData('m', 'c', h);

    expect(h.calls.data).toEqual([null]);
    expect(h.calls.error).toEqual(['Failed to fetch loyalty data']);
    expect(h.calls.loading).toEqual([true, false]);
  });

  it('reports network failures and clears data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hangup');
      })
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const h = handlers();
    await loadLoyaltyData('m', 'c', h);

    expect(h.calls.data).toEqual([null]);
    expect(h.calls.error).toEqual(['socket hangup']);
  });

  it('stores fetched data and clears errors on success', async () => {
    const payload = { enrolled: true, points_balance: 42 };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => payload,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const h = handlers();
    await loadLoyaltyData('m', 'c', h);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/storefront/loyalty?'),
      expect.anything()
    );
    expect(h.calls.data).toEqual([payload]);
    expect(h.calls.error).toEqual([null]);
    expect(h.calls.loading).toEqual([true, false]);
  });

  it('suppresses every state update once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const h = handlers();
    await loadLoyaltyData('m', 'c', h, controller.signal);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.calls.data).toEqual([]);
    expect(h.calls.error).toEqual([]);
    expect(h.calls.loading).toEqual([]);
  });
});
