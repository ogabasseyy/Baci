import { describe, expect, it } from 'vitest';
import {
  repairBookingWizardDefaultShippingQuote,
  repairBookingWizardMerchantId,
  repairBookingWizardPreselection,
} from './repair-booking-wizard.pickup-payment.fixtures';

describe('repair-booking-wizard.pickup-payment.fixtures', () => {
  it('pins the pickup payment wizard test fixtures', () => {
    expect(repairBookingWizardPreselection.deviceSlug).toBe('apple-iphone-15');
    expect(repairBookingWizardMerchantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(repairBookingWizardDefaultShippingQuote.price).toBe(8250);
  });
});
