import { render, screen } from '@testing-library/react-native';
import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
import { SavingsPhoneThumb } from './SavingsPhoneThumb';

// Pictures come from the catalogue, not PiggyVest: the thumb behaves the
// same with the server off.
describe('savings phone thumb with the server off', () => {
  it('shows the phone picture when there is one', () => {
    render(
      <SavingsPhoneThumb
        background="#fff"
        iconColor="#c00"
        image="https://example.test/phone.png"
        title="iPhone 14"
      />
    );
    expect(screen.getByLabelText('iPhone 14')).toBeTruthy();
  });

  it('falls back to a phone icon without a picture', () => {
    render(
      <SavingsPhoneThumb
        background="#fff"
        iconColor="#000"
        image={null}
        title="Phone"
      />
    );
    expect(screen.queryByLabelText('Phone')).toBeNull();
  });

  it('shows the phone icon, not the "No Image" placeholder', () => {
    render(
      <SavingsPhoneThumb
        background="#fff"
        iconColor="#c00"
        image={PRODUCT_PLACEHOLDER_IMAGE}
        title="iPhone 14"
      />
    );
    expect(screen.queryByLabelText('iPhone 14')).toBeNull();
  });
});
