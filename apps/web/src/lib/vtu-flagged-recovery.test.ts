import { describe, expect, it } from 'vitest';
import { isFlaggedReferenceLessVtuRow } from './vtu-flagged-recovery';
import { STRANDED_PRE_VEND_STALE_MS } from './vtu-pre-vend-recovery';

describe('isFlaggedReferenceLessVtuRow', () => {
  const staleAt = new Date(
    Date.now() - STRANDED_PRE_VEND_STALE_MS - 1000
  ).toISOString();
  const freshAt = new Date(Date.now() - 1000).toISOString();
  const base = {
    id: 'vtu-1',
    status: 'processing' as const,
    transaction_id: null,
    error_message: null,
    request_reference: 'VTU-REQ-1',
    updated_at: staleAt,
  };

  it('flags a stale debited Kuda row carrying only the request reference', () => {
    // Post-vend persist failure: the flag proves the debit landed,
    // and Kuda BILL_TSQ resolves by BillRequestRef, so provider
    // truth can settle the row without ever re-vending.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { walletDebited: true },
      })
    ).toBe(true);
  });

  it('flags a Kuda-fallback row via its pre-persisted provider switch', () => {
    // Monnify-airtime fallback persists provider=kuda BEFORE the Kuda
    // call, so a result-persist crash still leaves a Kuda-routable
    // row: Kuda TSQ resolves by request_reference even though the row
    // started life as Monnify and carries no Monnify vend reference.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: {
          fulfillmentProvider: 'kuda',
          monnifyFallbackError: 'Monnify API error: 400',
          originalProvider: 'monnify',
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
          walletDebited: true,
        },
      })
    ).toBe(true);
  });

  it('flags a stale debited Monnify row carrying its vend reference', () => {
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        request_reference: null,
        metadata: {
          provider: 'monnify',
          walletDebited: true,
          monnifyVendReference: 'VEND-1',
        },
      })
    ).toBe(true);
  });

  it('declines rows without the requery key for their route', () => {
    // Kuda without a request reference: the keyless status call
    // reports failed, which would wrongfully fail/refund. Monnify
    // without a vend reference: requery cannot run at all.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        request_reference: '  ',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { provider: 'monnify', walletDebited: true },
      })
    ).toBe(false);
  });

  it('declines rows a live worker could still hold', () => {
    // A mid-flight vend misread as failed would refund while value
    // lands — only stale rows requery.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { walletDebited: true },
        updated_at: freshAt,
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { walletDebited: true },
        updated_at: null,
      })
    ).toBe(false);
  });

  it('declines unflagged rows and rows the claim already handles', () => {
    // Unflagged: pre-vend recovery's domain (mutually exclusive by
    // the flag). With references: the normal claim path.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { paymentSplit: { wallet: 1000, card: 0 } },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        transaction_id: 'PROV-1',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        error_message: 'provider said maybe',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        status: 'pending',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
  });
});
