import { describe, expect, it, vi } from 'vitest';
import type { CallResult } from './provider-ops';
import {
  foundAnswer,
  isTransientFailure,
  okData,
  pollSettled,
  recordOf,
  usableList,
} from './read-rules';

const call = (over: Partial<CallResult> = {}): CallResult => ({
  ok: true,
  httpStatus: 200,
  data: undefined,
  envelope: null,
  message: null,
  declined: false,
  errorCode: null,
  typedAccepted: null,
  ...over,
});

describe('isTransientFailure', () => {
  it.each([
    [null, true],
    [500, true],
    [502, true],
    [503, true],
    [429, true],
    [408, true],
    [404, false],
    [400, false],
    [200, false],
  ])('status %s -> %s', (status, transient) => {
    expect(isTransientFailure(status)).toBe(transient);
  });
});

describe('recordOf', () => {
  it('returns the data only for a successful call carrying a plain object', () => {
    expect(recordOf(call({ data: { a: 1 } }))).toEqual({ a: 1 });
  });
  it.each([
    ['not ok', call({ ok: false, data: { a: 1 } })],
    ['no data', call({ data: undefined })],
    ['array', call({ data: [1] })],
    ['string', call({ data: 'x' })],
    ['null', call({ data: null })],
  ])('is null when %s', (_name, result) => {
    expect(recordOf(result)).toBeNull();
  });
});

describe('usableList', () => {
  const edges = [{ id: 'a' }];
  it('accepts a successful call with a recognised container, empty or not', () => {
    expect(
      usableList(call({ data: { paginatedPayload: { edges } } }))?.edges
    ).toEqual(edges);
    expect(usableList(call({ data: { edges: [] } }))?.edges).toEqual([]);
    expect(usableList(call({ data: [] }))?.container).toBe('array');
  });
  it.each([
    ['a failed request', call({ ok: false, httpStatus: 503, data: undefined })],
    ['an unrecognised container', call({ data: { rows: [] } })],
    ['no data', call({ data: undefined })],
  ])('is null for %s, so an empty list is never read as "absent"', (_name, result) => {
    expect(usableList(result)).toBeNull();
  });
});

describe('foundAnswer', () => {
  it('yes when the lookup succeeded', () => {
    expect(foundAnswer(call())).toBe('yes');
  });
  it('no only for a definite not-found decline from the provider', () => {
    expect(
      foundAnswer(call({ ok: false, httpStatus: 404, declined: true }))
    ).toBe('no');
    expect(
      foundAnswer(call({ ok: false, httpStatus: 400, declined: true }))
    ).toBe('no');
  });
  it('unknown for transient failures, network errors and undeclined errors', () => {
    expect(
      foundAnswer(call({ ok: false, httpStatus: 503, declined: true }))
    ).toBe('unknown');
    expect(
      foundAnswer(call({ ok: false, httpStatus: null, declined: false }))
    ).toBe('unknown');
    expect(
      foundAnswer(call({ ok: false, httpStatus: 502, declined: false }))
    ).toBe('unknown');
    expect(
      foundAnswer(call({ ok: false, httpStatus: 429, declined: true }))
    ).toBe('unknown');
  });
});

describe('pollSettled', () => {
  const budget = () => ({
    maxPolls: 4,
    pollIntervalMs: 10,
    sleep: vi.fn(async () => undefined),
  });

  it('returns at once when the first read is already settled (no sleeping)', async () => {
    const b = budget();
    const result = await pollSettled(
      b,
      async () => 5,
      (v) => v === 5
    );
    expect(result).toEqual({ value: 5, settled: true, polls: 1 });
    expect(b.sleep).not.toHaveBeenCalled();
  });

  it('keeps reading within the budget until the reading settles', async () => {
    const b = budget();
    let n = 0;
    const result = await pollSettled(
      b,
      async () => (n += 1),
      (v) => v >= 3
    );
    expect(result).toEqual({ value: 3, settled: true, polls: 3 });
    expect(b.sleep).toHaveBeenCalledTimes(2);
    expect(b.sleep).toHaveBeenCalledWith(10);
  });

  it('gives up after the budget and says it never settled, with the last reading', async () => {
    const b = budget();
    let n = 0;
    const result = await pollSettled(
      b,
      async () => (n += 1),
      () => false
    );
    expect(result).toEqual({ value: 5, settled: false, polls: 5 });
    expect(b.sleep).toHaveBeenCalledTimes(4);
  });
});

describe('okData', () => {
  it('returns the data of a successful call', () => {
    expect(okData(call({ data: { balance: 1 } }))).toEqual({ balance: 1 });
    expect(okData(call({ data: [1, 2] }))).toEqual([1, 2]);
  });

  it('returns undefined for a failed call, even when it kept a valid-looking envelope', () => {
    const failed = call({
      ok: false,
      httpStatus: 503,
      data: { id: 'w', balance: 0, withdrawal_count: 0 },
    });
    expect(okData(failed)).toBeUndefined();
    expect(
      okData(call({ ok: false, httpStatus: null, data: [1] }))
    ).toBeUndefined();
  });
});
