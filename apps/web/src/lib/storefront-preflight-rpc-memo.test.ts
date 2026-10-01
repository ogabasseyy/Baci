import { beforeEach, describe, expect, it } from 'vitest';
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

  it('identifies timeout markers', () => {
    const timeoutKey = key('timeout_fn', {}, undefined);
    write(timeoutKey, timeout);

    expect(read(timeoutKey)).toBe(timeout);
    expect(isTimeout(read(timeoutKey))).toBe(true);
    expect(isEmptyResult(read(timeoutKey))).toBe(false);
  });
});
