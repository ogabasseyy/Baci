import { describe, expect, it } from 'vitest';
import { boundedStorefrontPreflightRpcErrorDetail } from './storefront-preflight-rpc-error-detail';

describe('boundedStorefrontPreflightRpcErrorDetail', () => {
  it('joins code and message within the bound', () => {
    expect(boundedStorefrontPreflightRpcErrorDetail('57014', 'timeout')).toBe(
      '57014 timeout'
    );
  });

  it('truncates to 160 chars and maps empty to undefined', () => {
    expect(
      boundedStorefrontPreflightRpcErrorDetail('E', 'x'.repeat(200))
    ).toHaveLength(160);
    expect(boundedStorefrontPreflightRpcErrorDetail('', '')).toBeUndefined();
  });
});
