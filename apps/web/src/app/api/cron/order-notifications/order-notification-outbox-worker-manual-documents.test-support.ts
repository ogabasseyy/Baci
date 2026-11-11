import { vi } from 'vitest';

export function createSupabase(
  errors: unknown[],
  liveMetadata: Record<string, unknown> = {},
  classifyRow: Record<string, unknown> | null = null,
  classifyError: unknown = null,
  reclaimRow: Record<string, unknown> | null = {
    dispatch_started_at: null,
    last_error: null,
  },
  reclaimError: unknown = null
) {
  const updateErrors = [...errors];
  const select = vi.fn();
  // The sent path re-reads the live row (select metadata) before the status
  // update (select id); resolve each from its own source. The manual path
  // classifies a 0-row sent update with a second read, and reclaims a
  // clear-failed marker before dispatching.
  const maybeSingle = vi.fn(() => {
    const lastSelect = select.mock.calls[select.mock.calls.length - 1]?.[0];
    if (lastSelect === 'metadata' || lastSelect === 'metadata, updated_at') {
      return {
        data: {
          id: row.id,
          metadata: liveMetadata,
          updated_at: '2026-10-03T00:00:00Z',
        },
        error: null,
      };
    }
    if (lastSelect === 'dispatch_started_at, last_error') {
      return { data: reclaimError ? null : reclaimRow, error: reclaimError };
    }
    if (typeof lastSelect === 'string' && lastSelect.includes('locked_by')) {
      return { data: classifyError ? null : classifyRow, error: classifyError };
    }
    const error = updateErrors.shift();
    if (error === 'zero-rows') {
      return { data: null, error: null };
    }
    return { data: error ? null : { id: row.id }, error: error ?? null };
  });
  const builder = {
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    match: vi.fn(() => builder),
    maybeSingle,
    not: vi.fn(() => builder),
    select,
    update: vi.fn((_values: Record<string, unknown>) => builder),
  };
  select.mockImplementation(() => builder);
  return { client: { from: vi.fn(() => builder) }, builder };
}

export const row = {
  attempt_count: 1,
  claim_owner: 'worker-1',
  event_type: 'order_shipped' as const,
  id: '10000000-0000-4000-8000-000000000001',
  max_attempts: 5,
  merchant_id: '10000000-0000-4000-8000-000000000002',
  order_id: '10000000-0000-4000-8000-000000000003',
};

export function finalAttempt(
  eventType: 'manual_order_invoice' | 'manual_order_receipt'
) {
  return { ...row, event_type: eventType, attempt_count: 5, max_attempts: 5 };
}
