import { describe, expect, it } from 'vitest';
import { parseUtilityVoucherBackfill } from './utility-voucher-backfill-model';

describe('parseUtilityVoucherBackfill', () => {
  it('extracts the pin for the matching reference', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            { request_reference: 'OTHER', status: 'successful' },
            {
              request_reference: 'VTU-1',
              status: 'successful',
              voucher_pin: ' 1234-5678 ',
              refund_pending: false,
              refund_skipped: false,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: false,
      pin: '1234-5678',
      refundConfirmed: true,
      refundSkipped: false,
      refundedAmount: null,
      successful: true,
    });
  });

  it('reports success even when no voucher is expected', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'successful',
              refund_pending: false,
              refund_skipped: false,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: false,
      pin: null,
      refundConfirmed: true,
      refundSkipped: false,
      refundedAmount: null,
      successful: true,
    });
  });

  it('reports a refund-confirmed failure with the amount', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'failed',
              refund_pending: false,
              refund_skipped: false,
              refunded_to_wallet: 1000,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: true,
      pin: null,
      refundConfirmed: true,
      refundSkipped: false,
      refundedAmount: 1000,
      successful: false,
    });
  });

  it('marks a failed row with a pending refund as unconfirmed', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'failed',
              refund_pending: true,
              refund_skipped: false,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: true,
      pin: null,
      refundConfirmed: false,
      refundSkipped: false,
      refundedAmount: null,
      successful: false,
    });
  });

  it('fails closed when the refund flag is missing', () => {
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [{ request_reference: 'VTU-1', status: 'failed' }],
        },
        'VTU-1'
      )
    ).toMatchObject({ failed: true, refundConfirmed: false });
  });

  it('reports a skipped refund as failed-but-not-refunded', () => {
    // Codex R110 P2: skipped rows are not pending, but nothing was
    // credited — confirming would print "was refunded" copy for a
    // refund that never ran.
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'failed',
              refund_pending: false,
              refund_skipped: true,
            },
          ],
        },
        'VTU-1'
      )
    ).toEqual({
      failed: true,
      pin: null,
      refundConfirmed: false,
      refundSkipped: true,
      refundedAmount: null,
      successful: false,
    });
  });

  it('fails closed when the skipped flag is missing', () => {
    // A pre-deploy cached body (pending settled, skipped key
    // absent) must keep polling, not confirm: the refetch carries
    // the key and settles correctly.
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [
            {
              request_reference: 'VTU-1',
              status: 'failed',
              refund_pending: false,
            },
          ],
        },
        'VTU-1'
      )
    ).toMatchObject({
      failed: true,
      refundConfirmed: false,
      refundSkipped: false,
    });
  });

  it('keeps polling when the row is missing or pin-less and non-terminal', () => {
    expect(parseUtilityVoucherBackfill({ transactions: [] }, 'VTU-1')).toEqual(
      {
        failed: false,
        pin: null,
        refundConfirmed: false,
      refundSkipped: false,
        refundedAmount: null,
        successful: false,
      }
    );
    expect(
      parseUtilityVoucherBackfill(
        {
          transactions: [{ request_reference: 'VTU-1', status: 'processing' }],
        },
        'VTU-1'
      )
    ).toMatchObject({ failed: false, pin: null, successful: false });
  });

  it('returns null on a schema mismatch so polling halts', () => {
    expect(parseUtilityVoucherBackfill({ nope: true }, 'VTU-1')).toBeNull();
    expect(parseUtilityVoucherBackfill(null, 'VTU-1')).toBeNull();
  });
});

;

;

;

