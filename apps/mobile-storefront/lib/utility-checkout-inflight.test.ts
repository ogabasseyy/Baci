import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import {
  acquireUtilityCheckoutOrAlert,
  releaseUtilityCheckout,
  tryAcquireUtilityCheckout,
} from './utility-checkout-inflight';

describe('utility checkout in-flight guard', () => {
  // Release is a safe no-op without a hold, so this cannot mask a
  // test that forgot its own release pairing.
  afterEach(releaseUtilityCheckout);

  it('grants the first acquirer and refuses concurrent checkouts', () => {
    // Codex R77 6sNGO3: the second tab's submit while the first is
    // in flight must refuse instead of debiting concurrently.
    expect(tryAcquireUtilityCheckout()).toBe(true);
    expect(tryAcquireUtilityCheckout()).toBe(false);
  });

  it('grants again after release', () => {
    expect(tryAcquireUtilityCheckout()).toBe(true);
    releaseUtilityCheckout();
    expect(tryAcquireUtilityCheckout()).toBe(true);
  });

  it('alerts instead of acquiring when a checkout is running', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      expect(acquireUtilityCheckoutOrAlert()).toBe(true);
      expect(acquireUtilityCheckoutOrAlert()).toBe(false);
      expect(alertSpy).toHaveBeenCalledWith(
        'Checkout in progress',
        expect.any(String)
      );
    } finally {
      alertSpy.mockRestore();
    }
  });
});
