import { describe, expect, it } from 'vitest';
import {
  decodeTransferReference,
  encodeTransferReference,
  MAX_TRANSFER_ATTEMPT,
  mintTransferReference,
  nextTransferReference,
  TransferReferenceError,
} from './transfer-reference';

const legId = '00000000-0000-4000-8000-0000000000a1';
const otherLegId = '00000000-0000-4000-8000-0000000000b2';

function errorCodeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof TransferReferenceError) return error.code;
    throw error;
  }
  return undefined;
}

describe('transfer attempt reference codec', () => {
  it('writes the engine format pvb-<kind>-<legId>-<attempt>', () => {
    // Same text as the database builds it:
    // 'pvb-wt-' || transfer_id::text || '-' || attempt::text
    expect(encodeTransferReference({ kind: 'wt', legId, attempt: 1 })).toBe(
      `pvb-wt-${legId}-1`
    );
    expect(encodeTransferReference({ kind: 'wt', legId, attempt: 1000 })).toBe(
      `pvb-wt-${legId}-1000`
    );
  });

  it.each([
    1, 2, 9, 10, 99, 100, 999, 1000,
  ])('round-trips attempt %i', (attempt) => {
    const parts = { kind: 'wt' as const, legId, attempt };
    const reference = encodeTransferReference(parts);
    const decoded = decodeTransferReference(reference);
    expect(decoded).toEqual(parts);
    expect(decoded && encodeTransferReference(decoded)).toBe(reference);
  });

  it.each([
    ['an uppercase leg id', `pvb-wt-${legId.toUpperCase()}-1`],
    ['a zero-padded attempt', `pvb-wt-${legId}-01`],
    ['attempt zero', `pvb-wt-${legId}-0`],
    ['an attempt past the cap', `pvb-wt-${legId}-1001`],
    ['a negative attempt', `pvb-wt-${legId}--1`],
    ['no attempt', `pvb-wt-${legId}`],
    ['an unknown kind', `pvb-xx-${legId}-1`],
    ['a legacy savings reference', `pvb-save-${legId}`],
    ['a savings reference with a suffix', `pvb-save-${legId}-1`],
    ['a trailing suffix', `pvb-wt-${legId}-1-1`],
    ['surrounding whitespace', ` pvb-wt-${legId}-1`],
    ['a trailing newline', `pvb-wt-${legId}-1\n`],
    ['an uppercase prefix', `PVB-WT-${legId}-1`],
    ['a short leg id', 'pvb-wt-00000000-0000-4000-8000-0000000000a-1'],
    ['an empty string', ''],
  ])('decodes %s as not ours', (_label, reference) => {
    expect(decodeTransferReference(reference)).toBeNull();
  });

  it.each([
    null,
    undefined,
    42,
    { kind: 'wt', legId, attempt: 1 },
  ])('decodes a non-string %j as not ours', (value) => {
    expect(decodeTransferReference(value)).toBeNull();
  });

  it.each([
    { kind: 'wt', legId, attempt: 0 },
    { kind: 'wt', legId, attempt: MAX_TRANSFER_ATTEMPT + 1 },
    { kind: 'wt', legId, attempt: 1.5 },
    { kind: 'wt', legId, attempt: Number.NaN },
    { kind: 'wt', legId: legId.toUpperCase(), attempt: 1 },
    { kind: 'wt', legId: 'not-a-uuid', attempt: 1 },
    { kind: 'save', legId, attempt: 1 },
  ])('refuses to encode %j', (parts) => {
    expect(
      errorCodeOf(() =>
        encodeTransferReference(
          parts as Parameters<typeof encodeTransferReference>[0]
        )
      )
    ).toBe('TRANSFER_REFERENCE_INVALID');
  });
});

describe('transfer attempt minting', () => {
  const first = `pvb-wt-${legId}-1`;
  const second = `pvb-wt-${legId}-2`;

  it('starts a new leg at attempt 1', () => {
    expect(nextTransferReference({ kind: 'wt', legId, previous: [] })).toBe(
      first
    );
  });

  it('moves past every earlier attempt whatever their order', () => {
    expect(
      nextTransferReference({ kind: 'wt', legId, previous: [second, first] })
    ).toBe(`pvb-wt-${legId}-3`);
  });

  it.each([
    [1, [first]],
    [2, [first, second]],
    [1, [first, second]],
  ])('refuses to reuse attempt %i after %j', (attempt, previous) => {
    expect(
      errorCodeOf(() =>
        mintTransferReference({ kind: 'wt', legId, attempt, previous })
      )
    ).toBe('TRANSFER_ATTEMPT_REUSED');
  });

  it('accepts a strictly newer attempt', () => {
    expect(
      mintTransferReference({
        kind: 'wt',
        legId,
        attempt: 3,
        previous: [first, second],
      })
    ).toBe(`pvb-wt-${legId}-3`);
  });

  it.each([
    ['another leg', `pvb-wt-${otherLegId}-1`],
    ['a legacy savings reference', `pvb-save-${legId}`],
    ['an unreadable reference', 'not-ours'],
  ])('refuses a history holding %s', (_label, foreign) => {
    // A history it cannot read gives no proof the attempt is fresh.
    expect(
      errorCodeOf(() =>
        nextTransferReference({ kind: 'wt', legId, previous: [foreign] })
      )
    ).toBe('TRANSFER_ATTEMPT_HISTORY_FOREIGN');
  });

  it('refuses to go past the attempt cap', () => {
    expect(
      errorCodeOf(() =>
        nextTransferReference({
          kind: 'wt',
          legId,
          previous: [`pvb-wt-${legId}-${MAX_TRANSFER_ATTEMPT}`],
        })
      )
    ).toBe('TRANSFER_ATTEMPTS_EXHAUSTED');
  });
});
