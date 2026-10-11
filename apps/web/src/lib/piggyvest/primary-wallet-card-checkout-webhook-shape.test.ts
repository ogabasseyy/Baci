import { describe, expect, it } from 'vitest';
import {
  isReversalEvent,
  reversalTransactionReference,
  webhookMetadataOf,
  webhookObject,
} from './primary-wallet-card-checkout-webhook-shape';

describe('primary card checkout webhook shape', () => {
  it('reads plain objects and rejects arrays, nulls, and primitives', () => {
    expect(webhookObject({ a: 1 })).toEqual({ a: 1 });
    expect(webhookObject([1])).toBeNull();
    expect(webhookObject(null)).toBeNull();
    expect(webhookObject('x')).toBeNull();
  });

  it('reads object metadata from the data envelope', () => {
    expect(
      webhookMetadataOf({ data: { metadata: { operation_id: 'op-1' } } })
    ).toEqual({ operation_id: 'op-1' });
  });

  it('parses JSON-encoded metadata strings', () => {
    expect(
      webhookMetadataOf({ data: { metadata: '{"operation_id":"op-1"}' } })
    ).toEqual({ operation_id: 'op-1' });
  });

  it('rejects malformed metadata without throwing', () => {
    expect(webhookMetadataOf({ data: { metadata: '{invalid' } })).toBeNull();
    expect(webhookMetadataOf({ data: {} })).toBeNull();
    expect(webhookMetadataOf(null)).toBeNull();
  });

  it.each([
    'refund.processed',
    'charge.dispute.create',
    'charge.dispute.resolve',
  ])('recognizes %s as a money-out event', (event) => {
    expect(isReversalEvent(event)).toBe(true);
  });

  it('rejects charge events as money-out events', () => {
    expect(isReversalEvent('charge.success')).toBe(false);
    expect(isReversalEvent(null)).toBe(false);
  });

  it('resolves the original reference across refund and dispute shapes', () => {
    expect(
      reversalTransactionReference({ transaction_reference: 'ref-top' })
    ).toBe('ref-top');
    expect(
      reversalTransactionReference({ transaction_ref: 'ref-dispute' })
    ).toBe('ref-dispute');
    expect(
      reversalTransactionReference({ transaction: { reference: 'ref-nested' } })
    ).toBe('ref-nested');
    expect(
      reversalTransactionReference({ dispute: { reference: 'ref-dispute' } })
    ).toBe('ref-dispute');
    expect(reversalTransactionReference({ id: 1 })).toBeNull();
  });
});
