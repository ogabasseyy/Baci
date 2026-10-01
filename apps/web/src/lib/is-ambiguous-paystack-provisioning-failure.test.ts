import { describe, expect, it } from 'vitest';
import { isAmbiguousPaystackProvisioningFailure } from './is-ambiguous-paystack-provisioning-failure';

describe('isAmbiguousPaystackProvisioningFailure', () => {
  it('treats transport and 5xx outcomes as non-terminal', () => {
    expect(
      isAmbiguousPaystackProvisioningFailure({ code: 'NETWORK_ERROR' })
    ).toBe(true);
    expect(isAmbiguousPaystackProvisioningFailure({ code: 'HTTP_503' })).toBe(
      true
    );
    expect(isAmbiguousPaystackProvisioningFailure(new Error('timeout'))).toBe(
      true
    );
  });

  it('treats explicit provider rejections as terminal', () => {
    expect(
      isAmbiguousPaystackProvisioningFailure({
        success: false,
        code: 'VALIDATION_ERROR',
      })
    ).toBe(false);
    expect(isAmbiguousPaystackProvisioningFailure({ success: false })).toBe(
      false
    );
  });
});
