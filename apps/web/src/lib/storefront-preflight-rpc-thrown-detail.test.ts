import { describe, expect, it } from 'vitest';
import { getStorefrontPreflightRpcThrownErrorDetail } from './storefront-preflight-rpc-thrown-detail';

describe('getStorefrontPreflightRpcThrownErrorDetail', () => {
  it('details Error and DOMException throws, ignores anything else', () => {
    expect(getStorefrontPreflightRpcThrownErrorDetail(new Error('boom'))).toBe(
      'Error boom'
    );
    expect(
      getStorefrontPreflightRpcThrownErrorDetail(
        new DOMException('timed out', 'TimeoutError')
      )
    ).toBe('TimeoutError timed out');
    expect(getStorefrontPreflightRpcThrownErrorDetail('boom')).toBeUndefined();
    expect(getStorefrontPreflightRpcThrownErrorDetail(null)).toBeUndefined();
  });
});
