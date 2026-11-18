import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontPreflightRpcMemo } from './storefront-preflight-rpc-memo';

const {
  clear,
  emptyResult,
  isEmptyResult,
  isTimeout,
  key,
  read,
  timeout,
  write,
} = storefrontPreflightRpcMemo;

describe('storefront preflight RPC memo', () => {
  beforeEach(() => {
    clear();
  });

  it('keeps empty-result markers isolated from ordinary calls', () => {
    const args = { p_identifier: 'unknown.example' };
    const unknownKey = key('resolve_storefront_auth_merchant', args, 'unknown');
    const ordinaryKey = key(
      'resolve_storefront_auth_merchant',
      args,
      undefined
    );

    write(unknownKey, emptyResult);

    expect(read(unknownKey)).toBe(emptyResult);
    expect(read(ordinaryKey)).toBeUndefined();
    expect(isEmptyResult(read(unknownKey))).toBe(true);
    expect(isTimeout(read(unknownKey))).toBe(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('identifies timeout markers', () => {
    const timeoutKey = key('timeout_fn', {}, undefined);
    write(timeoutKey, timeout);

    expect(read(timeoutKey)).toBe(timeout);
    expect(isTimeout(read(timeoutKey))).toBe(true);
    expect(isEmptyResult(read(timeoutKey))).toBe(false);
  });

  it('respects custom TTLs for positive and negative verdicts', () => {
    vi.useFakeTimers();
    const posKey = key(
      'get_storefront_pdp_preflight',
      { p_slug: 'a' },
      undefined
    );
    const negKey = key(
      'get_storefront_pdp_preflight',
      { p_slug: 'b' },
      undefined
    );

    write(posKey, { present: true }, 60_000);
    write(negKey, { present: false }, 15_000);

    vi.advanceTimersByTime(14_999);
    expect(read(posKey)).toEqual({ present: true });
    expect(read(negKey)).toEqual({ present: false });

    vi.advanceTimersByTime(2);
    expect(read(negKey)).toBeUndefined();
    expect(read(posKey)).toEqual({ present: true });

    vi.advanceTimersByTime(45_000);
    expect(read(posKey)).toBeUndefined();
  });
});
