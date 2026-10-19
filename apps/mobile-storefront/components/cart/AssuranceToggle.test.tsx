import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { CartItem } from '@/stores/cart-store';
import AssuranceToggle from './AssuranceToggle';

function createItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'cart-1',
    product_id: 'product-1',
    slug: 'iphone-13-pro',
    name: 'iPhone 13 Pro',
    price: 500000,
    quantity: 1,
    ...overrides,
  };
}

describe('AssuranceToggle', () => {
  it('shows enabled assurance pricing and toggles state', () => {
    const toggleAssurance = jest.fn();
    const item = createItem({ hasAssurance: true });

    render(
      <AssuranceToggle
        item={item}
        assuranceCost={25000}
        toggleAssurance={toggleAssurance}
        formatPrice={(value) => `₦${value.toLocaleString('en-NG')}`}
        colors={Colors.light}
      />
    );

    expect(screen.getByText('Ogabassey Assurance')).toBeTruthy();
    expect(screen.getByText('Screen & Liquid Damage +₦25,000')).toBeTruthy();
    expect(
      screen.getByText('Optional. Included in total; tap to remove.')
    ).toBeTruthy();

    fireEvent.press(
      screen.getByLabelText('Toggle Ogabassey Assurance for iPhone 13 Pro')
    );
    expect(toggleAssurance).toHaveBeenCalledWith(item.id);
  });

  it('shows default protection message when assurance is disabled', () => {
    const item = createItem({ hasAssurance: false });

    render(
      <AssuranceToggle
        item={item}
        assuranceCost={0}
        toggleAssurance={jest.fn()}
        formatPrice={(value) => `₦${value.toLocaleString('en-NG')}`}
        colors={Colors.light}
      />
    );

    expect(screen.getByText('Device Protection (+5%)')).toBeTruthy();
  });
});
