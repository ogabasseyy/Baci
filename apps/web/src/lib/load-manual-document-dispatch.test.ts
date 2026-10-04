// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  loadManualDocumentDispatch,
  type ManualDocumentSnapshot,
} from './load-manual-document-dispatch';
import {
  merchantFixture,
  orderFixture,
  row,
} from './manual-order-document.test-utils';

function clientReturning(snapshot: unknown, error: unknown = null) {
  return { rpc: vi.fn(async () => ({ data: snapshot, error })) } as never;
}

function snapshotWith(
  order: unknown = orderFixture,
  merchant: unknown = merchantFixture
): ManualDocumentSnapshot {
  return {
    order,
    merchant,
    tax_subtotals: [],
    transactions: [],
    payment_accounts: [],
    claim_domain: null,
  };
}

describe('loadManualDocumentDispatch', () => {
  it('loads a ready dispatch through the claim-bound snapshot RPC', async () => {
    const supabase = clientReturning(snapshotWith());
    const result = await loadManualDocumentDispatch({ supabase, row });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_manual_order_document_snapshot',
      { p_outbox_id: 'outbox-1', p_claim_owner: 'worker-1' }
    );
    expect(result).toMatchObject({
      status: 'ready',
      paymentStatus: 'paid',
      recipient: { ok: true, email: 'ada@example.com' },
    });
  });

  it('fails when a re-arm stole the claim between claim and send', async () => {
    const result = await loadManualDocumentDispatch({
      supabase: clientReturning(null),
      row,
    });
    expect(result).toEqual({
      status: 'failed',
      error: 'dispatch_claim_superseded',
    });
  });

  it('throws on transient snapshot fetch failures for retry', async () => {
    await expect(
      loadManualDocumentDispatch({
        supabase: clientReturning(null, { message: 'db down' }),
        row,
      })
    ).rejects.toThrow('Manual document data unavailable');
  });

  it('skips when the order or merchant projection is missing', async () => {
    const result = await loadManualDocumentDispatch({
      supabase: clientReturning(snapshotWith(null, merchantFixture)),
      row,
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'order_or_merchant_missing',
    });
  });

  it('skips when the order shape fails validation', async () => {
    const result = await loadManualDocumentDispatch({
      supabase: clientReturning(
        snapshotWith({ ...orderFixture, total: 'not-money' }, merchantFixture)
      ),
      row,
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'order_validation_failed',
    });
  });

  it('skips a tenant-mismatched order instead of cross-tenant sending', async () => {
    const result = await loadManualDocumentDispatch({
      supabase: clientReturning(
        snapshotWith(
          { ...orderFixture, merchant_id: 'merchant-2' },
          merchantFixture
        )
      ),
      row,
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'ineligible_manual_order',
    });
  });

  it('skips imported orders that are not staff-recorded', async () => {
    const result = await loadManualDocumentDispatch({
      supabase: clientReturning(
        snapshotWith(
          {
            ...orderFixture,
            recorded_by_user_id: null,
            import_job_id: 'job-1',
          },
          merchantFixture
        )
      ),
      row,
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'ineligible_manual_order',
    });
  });

  it('skips orders without a customer or items', async () => {
    const noCustomer = await loadManualDocumentDispatch({
      supabase: clientReturning(
        snapshotWith({ ...orderFixture, customer_id: null }, merchantFixture)
      ),
      row,
    });
    expect(noCustomer).toEqual({
      status: 'skipped',
      reason: 'missing_customer',
    });
    const noItems = await loadManualDocumentDispatch({
      supabase: clientReturning(
        snapshotWith({ ...orderFixture, order_items: [] }, merchantFixture)
      ),
      row,
    });
    expect(noItems).toEqual({
      status: 'skipped',
      reason: 'missing_order_items',
    });
  });
});
