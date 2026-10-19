import { describe, expect, it } from '@jest/globals';
import { shouldAutoCollapseCheckoutContact } from './should-auto-collapse-checkout-contact';

describe('shouldAutoCollapseCheckoutContact', () => {
  it('keeps first-time contact editing open until every valid field is settled', () => {
    expect(
      shouldAutoCollapseCheckoutContact({
        hasInitialContactIdentity: false,
        isContactComplete: true,
        isContactSettled: false,
        wasContactComplete: false,
      })
    ).toBe(false);

    expect(
      shouldAutoCollapseCheckoutContact({
        hasInitialContactIdentity: false,
        isContactComplete: true,
        isContactSettled: true,
        wasContactComplete: false,
      })
    ).toBe(true);
  });

  it('does not auto-collapse a contact that was reopened for editing', () => {
    expect(
      shouldAutoCollapseCheckoutContact({
        hasInitialContactIdentity: false,
        isContactComplete: true,
        isContactSettled: true,
        wasContactComplete: true,
      })
    ).toBe(false);
  });
});
