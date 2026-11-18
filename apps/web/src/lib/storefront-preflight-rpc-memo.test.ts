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

  it('respects custom TTLs for published-active and default verdicts', () => {
    vi.useFakeTimers();
    const activeKey = key(
      'get_storefront_pdp_preflight',
      { p_slug: 'a' },
      undefined
    );
    const defaultKey = key(
      'get_storefront_pdp_preflight',
      { p_slug: 'b' },
      undefined
    );

    write(activeKey, { present: true }, 60_000);
    write(defaultKey, { present: false });

    vi.advanceTimersByTime(2_999);
    expect(read(activeKey)).toEqual({ present: true });
    expect(read(defaultKey)).toEqual({ present: false });

    vi.advanceTimersByTime(2);
    expect(read(defaultKey)).toBeUndefined();
    expect(read(activeKey)).toEqual({ present: true });

    vi.advanceTimersByTime(57_000);
    expect(read(activeKey)).toBeUndefined();
  });
});
