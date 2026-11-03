import { describe, expect, it } from 'vitest';
import {
  piggyvestCaptureProcessingStateSchema,
  piggyvestCaptureResultSchema,
  piggyvestCaptureStatusSchema,
  piggyvestClaimedCaptureSchema,
  piggyvestClaimedCapturesSchema,
} from './webhook-capture';

const id = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

describe('piggyvestCaptureResultSchema', () => {
  const result = { outcome: 'captured', id, processingState: 'pending' };

  it('accepts every outcome and processing state the database can report', () => {
    for (const outcome of ['captured', 'duplicate']) {
      for (const state of ['pending', 'claimed', 'processed', 'needs_review']) {
        expect(
          piggyvestCaptureResultSchema.safeParse({
            ...result,
            outcome,
            processingState: state,
          }).success
        ).toBe(true);
      }
    }
  });

  it.each([
    ['an unknown outcome', { outcome: 'updated' }],
    ['a non-uuid id', { id: 'not-a-uuid' }],
    ['an unknown state', { processingState: 'done' }],
    ['a missing id', { id: undefined }],
  ])('rejects %s', (_name, override) => {
    expect(
      piggyvestCaptureResultSchema.safeParse({ ...result, ...override }).success
    ).toBe(false);
  });

  it('rejects a non-object receipt', () => {
    for (const value of [null, 'captured', true, []]) {
      expect(piggyvestCaptureResultSchema.safeParse(value).success).toBe(false);
    }
  });

  it('exposes the processing states for the queue', () => {
    expect(piggyvestCaptureProcessingStateSchema.options).toEqual([
      'pending',
      'claimed',
      'processed',
      'needs_review',
    ]);
  });
});

describe('piggyvestClaimedCaptureSchema', () => {
  const claim = {
    capture_id: id,
    claim_token: '6b9d2f4a-3c1e-4a5b-9d8f-2e4b6a8c0d12',
    raw_hex: '7b7d',
    signature: 'ab'.repeat(64),
    key_version: 'k-0123456789abcdef',
    key_families: ['legacy', 'bank'],
    attempts: 2,
    event_type: 'bank-transfer.inflow.success',
    provider_transaction_id: null,
  };
  const parse = (override: Record<string, unknown> = {}) =>
    piggyvestClaimedCaptureSchema.safeParse({ ...claim, ...override });

  it('accepts a full claim, an empty body and null identifiers', () => {
    expect(parse().success).toBe(true);
    expect(parse({ raw_hex: '' }).success).toBe(true);
    expect(parse({ event_type: null }).success).toBe(true);
  });

  it.each([
    ['odd-length hex', { raw_hex: 'abc' }],
    ['uppercase hex', { raw_hex: '7B7D' }],
    ['non-hex bytes', { raw_hex: 'zz' }],
    ['a short signature', { signature: 'ab' }],
    ['an uppercase signature', { signature: 'AB'.repeat(64) }],
    ['no key families', { key_families: [] }],
    ['an unknown key family', { key_families: ['other'] }],
    ['zero attempts', { attempts: 0 }],
    ['fractional attempts', { attempts: 1.5 }],
    ['a non-uuid claim token', { claim_token: 'nope' }],
    ['an empty key version', { key_version: '' }],
  ])('rejects %s', (_name, override) => {
    expect(parse(override).success).toBe(false);
  });
});

describe('piggyvestClaimedCapturesSchema', () => {
  const claim = {
    capture_id: id,
    claim_token: '0c0e3c1f-7a43-4b55-9c0e-6a3d2b1f9e10',
    raw_hex: '7b7d',
    signature: 'ab'.repeat(64),
    key_version: 'k-0123456789abcdef',
    key_families: ['legacy'],
    attempts: 1,
    event_type: null,
    provider_transaction_id: null,
  };

  it('accepts an empty claim and a list of valid claims', () => {
    expect(piggyvestClaimedCapturesSchema.safeParse([]).success).toBe(true);
    expect(
      piggyvestClaimedCapturesSchema.safeParse([claim, claim]).success
    ).toBe(true);
  });

  it('rejects the whole batch when any claim is malformed', () => {
    expect(
      piggyvestClaimedCapturesSchema.safeParse([
        claim,
        { ...claim, attempts: 0 },
      ]).success
    ).toBe(false);
  });

  it('rejects a response that is not a list', () => {
    for (const value of [null, undefined, claim, 'rows']) {
      expect(piggyvestClaimedCapturesSchema.safeParse(value).success).toBe(
        false
      );
    }
  });
});

describe('piggyvestCaptureStatusSchema', () => {
  const status = {
    pending: 3,
    claimed: 1,
    needsReview: 0,
    oldestUnprocessedAt: '2026-10-30T11:00:00.000Z',
    lastCapturedAt: null,
    lastProcessedAt: null,
  };

  it('accepts counters with nullable timestamps', () => {
    expect(piggyvestCaptureStatusSchema.safeParse(status).success).toBe(true);
  });

  it.each([
    ['a negative counter', { pending: -1 }],
    ['a fractional counter', { claimed: 0.5 }],
    ['a string counter', { needsReview: '2' }],
    ['a missing field', { lastCapturedAt: undefined }],
  ])('rejects %s', (_name, override) => {
    expect(
      piggyvestCaptureStatusSchema.safeParse({ ...status, ...override }).success
    ).toBe(false);
  });
});
