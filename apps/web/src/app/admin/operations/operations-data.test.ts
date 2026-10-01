import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOperationsData } from './operations-data';

function operationsPayload() {
  return {
    capabilities: { canReadFinancials: false, canReplay: false },
    financial: {
      paymentSideEffects: [],
      payouts: [],
      reconciliationReview: [],
      settlements: [],
    },
    generatedAt: '2026-08-05T15:02:00.000Z',
    notifications: { email: [], orderOutbox: [], push: [], trackingOutbox: [] },
    shipping: { shipments: [], webhooks: [] },
    summary: {
      notifications: 0,
      paymentSideEffects: 0,
      payouts: 0,
      reconciliationReview: 0,
      settlements: 0,
      shipping: 0,
      workers: 0,
    },
    workers: [],
  };
}

describe('loadOperationsData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the redacted operations RPC and the existing event pipeline endpoint together', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => operationsPayload(),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          counts: { deliveries: 0, ingress: 0, unknown: 0 },
          deliveries: [],
          ingress: [],
          operations: { deliveries: [], heartbeats: [], queue: null },
          unknown: [],
        }),
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadOperationsData();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/operations?section=all&limit=25&offset=0'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/event-pipeline/dead-letters?kind=all&limit=25&offset=0'
    );
    expect(result.operations.data?.summary.workers).toBe(0);
    expect(result.operations.error).toBeNull();
    expect(result.eventPipeline.error).toBeNull();
  });

  it('keeps operations and event-pipeline incident pages on the same offset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => operationsPayload(),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          counts: { deliveries: 30, ingress: 0, unknown: 0 },
          deliveries: [],
          ingress: [],
          operations: { deliveries: [], heartbeats: [], queue: null },
          unknown: [],
        }),
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    await loadOperationsData(25);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/operations?section=all&limit=25&offset=25'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/event-pipeline/dead-letters?kind=all&limit=25&offset=25'
    );
  });

  it('keeps operations data available when the legacy event-pipeline request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => operationsPayload(),
          ok: true,
        })
        .mockResolvedValueOnce({ ok: false })
    );

    const result = await loadOperationsData();

    expect(result.operations.data?.summary.workers).toBe(0);
    expect(result.operations.error).toBeNull();
    expect(result.eventPipeline.data).toBeNull();
    expect(result.eventPipeline.error).toMatch(/could not be loaded/i);
  });

  it('keeps event-pipeline data available when the operations read model fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({
          json: async () => ({
            counts: { deliveries: 0, ingress: 0, unknown: 0 },
            deliveries: [],
            ingress: [],
            operations: { deliveries: [], heartbeats: [], queue: null },
            unknown: [],
          }),
          ok: true,
        })
    );

    const result = await loadOperationsData();

    expect(result.operations.data).toBeNull();
    expect(result.operations.error).toMatch(/could not be loaded/i);
    expect(result.eventPipeline.data?.counts.deliveries).toBe(0);
    expect(result.eventPipeline.error).toBeNull();
  });
});
