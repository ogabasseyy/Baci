import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';
import Colors from '@/constants/Colors';
import type { CartPriceChange } from '@/services/cart-reprice';
import PriceChangeModal from './PriceChangeModal';

const priceChanges: CartPriceChange[] = [
  {
    id: 'cart-1',
    name: 'iPhone 15 Pro',
    oldPrice: 1200000,
    newPrice: 1250000,
  },
  {
    id: 'cart-2',
    name: 'Samsung Galaxy S25',
    oldPrice: 980000,
    newPrice: 970000,
  },
];

describe('PriceChangeModal', () => {
  it('renders updated line prices for every changed cart item', () => {
    render(
      <PriceChangeModal
        visible
        changes={priceChanges}
        onClose={jest.fn()}
        colors={Colors.light}
      />
    );

    expect(screen.getByText('Prices updated')).toBeTruthy();
    expect(screen.getByText('iPhone 15 Pro')).toBeTruthy();
    expect(screen.getByText('Samsung Galaxy S25')).toBeTruthy();
    expect(screen.getByText('₦1,200,000')).toBeTruthy();
    expect(screen.getByText('₦1,250,000')).toBeTruthy();
    expect(screen.getByText('₦980,000')).toBeTruthy();
    expect(screen.getByText('₦970,000')).toBeTruthy();
  });

  it('renders a single changed line without the others', () => {
    render(
      <PriceChangeModal
        visible
        changes={[priceChanges[0]]}
        onClose={jest.fn()}
        colors={Colors.light}
      />
    );

    expect(screen.getByText('iPhone 15 Pro')).toBeTruthy();
    expect(screen.queryByText('Samsung Galaxy S25')).toBeNull();
  });

  it('renders the header but no line rows when there are no changes', () => {
    render(
      <PriceChangeModal
        visible
        changes={[]}
        onClose={jest.fn()}
        colors={Colors.light}
      />
    );

    expect(screen.getByText('Prices updated')).toBeTruthy();
    expect(screen.queryByText('iPhone 15 Pro')).toBeNull();
  });

  it('calls onClose from the backdrop, close button, and continue button', () => {
    const onClose = jest.fn();

    render(
      <PriceChangeModal
        visible
        changes={priceChanges}
        onClose={onClose}
        colors={Colors.light}
      />
    );

    fireEvent.press(screen.getByLabelText('Close modal'));
    fireEvent.press(screen.getByLabelText('Close'));
    fireEvent.press(screen.getByLabelText('Continue with updated prices'));

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('reports native dismissal through onDismissed', () => {
    // Regression: the host must keep the cart ad suppressed until the fade
    // dismissal actually completes, not just until the close handler runs.
    const onDismissed = jest.fn();
    const { UNSAFE_getByType } = render(
      <PriceChangeModal
        visible
        changes={priceChanges}
        onClose={jest.fn()}
        onDismissed={onDismissed}
        colors={Colors.light}
      />
    );

    act(() => {
      UNSAFE_getByType(Modal).props.onDismiss();
    });

    expect(onDismissed).toHaveBeenCalledTimes(1);
  });
});
