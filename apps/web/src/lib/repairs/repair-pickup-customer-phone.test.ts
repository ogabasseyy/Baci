import { describe, expect, it } from 'vitest';
import { repairPickupCustomerPhoneError } from './repair-pickup-customer-phone';

describe('repairPickupCustomerPhoneError', () => {
  it('bugfix: rejects separator-padded phones that pass length schema', () => {
    expect(repairPickupCustomerPhoneError('0803------')).toBe(
      'Enter a valid phone number with at least 10 digits.'
    );
  });

  it('accepts phones with at least 10 digits', () => {
    expect(repairPickupCustomerPhoneError('+2348012345678')).toBeNull();
  });
});
