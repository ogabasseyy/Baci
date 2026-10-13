import { describe, expect, it } from '@jest/globals';
import { getCheckoutLocationPickerVisibility } from './get-checkout-location-picker-visibility';

describe('getCheckoutLocationPickerVisibility', () => {
  it('shows pickers for a pickup station without a street address', () => {
    expect(
      getCheckoutLocationPickerVisibility('', 'Lagos', false, true, 'Lagos')
    ).toBe(true);
  });

  it('hides pickers when a complete geocoded address is selected', () => {
    expect(
      getCheckoutLocationPickerVisibility(
        '1 Main Street',
        'Ikeja',
        true,
        false,
        'Lagos'
      )
    ).toBe(false);
  });
});
