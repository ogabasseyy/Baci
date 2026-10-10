import { describe, expect, it } from 'vitest';
import {
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
});
