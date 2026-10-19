import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, View } from 'react-native';
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

  it('renders condition-only refreshes without a price row', () => {
    render(
      <PriceChangeModal
        visible
        changes={[]}
        conditionChanges={[
          {
            id: 'cart-1',
            name: 'iPhone 15 Pro',
            oldCondition: 'used',
            newCondition: 'refurbished',
          },
        ]}
        onClose={jest.fn()}
        colors={Colors.light}
      />
    );

    expect(screen.getByText('Items updated')).toBeTruthy();
    expect(screen.getByText('iPhone 15 Pro')).toBeTruthy();
    expect(screen.getByText('used')).toBeTruthy();
    expect(screen.getByText('refurbished')).toBeTruthy();
    expect(screen.queryByText('Prices updated')).toBeNull();
  });

  it('renders unavailable lines with a removal prompt', () => {
    render(
      <PriceChangeModal
        visible
        changes={[]}
        unavailableLines={[{ id: 'cart-9', name: 'Vanished Phone' }]}
        onClose={jest.fn()}
        colors={Colors.light}
      />
    );

    expect(screen.getByText('Items unavailable')).toBeTruthy();
    expect(screen.getByText('Vanished Phone')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(
      screen.getByLabelText('Vanished Phone: no longer available')
    ).toBeTruthy();
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

  it('keeps distinct keys when one line has both price and condition changes', () => {
    // A merchant edit can move an offer price and condition together,
    // landing the same line id in both lists. Identical sibling keys
    // let React reuse the wrong row on modal updates.
    const { UNSAFE_getAllByType } = render(
      <PriceChangeModal
        visible
        changes={[priceChanges[0]]}
        conditionChanges={[
          {
            id: 'cart-1',
            name: 'iPhone 15 Pro',
            oldCondition: 'new',
            newCondition: 'open_box',
          },
        ]}
        onClose={jest.fn()}
        colors={Colors.light}
      />
    );

    expect(screen.getByLabelText(/price changed from/)).toBeTruthy();
    expect(screen.getByLabelText(/condition changed from/)).toBeTruthy();
    // Keys live on the reconciled fibers (the React Compiler strips
    // them from createElement configs); duplicates reuse the wrong row.
    const rowKeys = UNSAFE_getAllByType(View)
      .filter((instance) =>
        String(instance.props.accessibilityLabel ?? '').includes('changed from')
      )
      .map(
        (instance) =>
          (
            instance as unknown as {
              _fiber: { key?: unknown };
            }
          )._fiber.key
      );
    expect(rowKeys).toHaveLength(2);
    expect(new Set(rowKeys).size).toBe(rowKeys.length);
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
