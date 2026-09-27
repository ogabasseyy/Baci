import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';
import Colors from '@/constants/Colors';
import type { CartItem } from '@/stores/cart-store';
import NegotiationWarningModal from './NegotiationWarningModal';

const cartItem: CartItem = {
  id: 'cart-1',
  product_id: 'product-1',
  slug: 'iphone-13-pro',
  name: 'iPhone 13 Pro',
  price: 500000,
  quantity: 1,
};

describe('NegotiationWarningModal', () => {
  it('calls onNegotiateItem and haptic when Negotiate This Item is pressed', () => {
    const onClose = jest.fn();
    const onNegotiateItem = jest.fn();
    const onBulkNegotiate = jest.fn();
    const triggerHaptic = jest.fn();

    render(
      <NegotiationWarningModal
        visible
        pendingItem={cartItem}
        onClose={onClose}
        onNegotiateItem={onNegotiateItem}
        onBulkNegotiate={onBulkNegotiate}
        triggerHaptic={triggerHaptic}
        colors={Colors.light}
      />
    );

    fireEvent.press(screen.getByText('Negotiate This Item'));
    expect(triggerHaptic).toHaveBeenCalledTimes(1);
    expect(onNegotiateItem).toHaveBeenCalledWith(cartItem);
    expect(onBulkNegotiate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onBulkNegotiate and haptic when Bulk Negotiate Entire Cart is pressed', () => {
    const onClose = jest.fn();
    const onNegotiateItem = jest.fn();
    const onBulkNegotiate = jest.fn();
    const triggerHaptic = jest.fn();

    render(
      <NegotiationWarningModal
        visible
        pendingItem={cartItem}
        onClose={onClose}
        onNegotiateItem={onNegotiateItem}
        onBulkNegotiate={onBulkNegotiate}
        triggerHaptic={triggerHaptic}
        colors={Colors.light}
      />
    );

    fireEvent.press(screen.getByText('Bulk Negotiate Entire Cart'));
    expect(triggerHaptic).toHaveBeenCalledTimes(1);
    expect(onBulkNegotiate).toHaveBeenCalledTimes(1);
    expect(onNegotiateItem).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is pressed', () => {
    const onClose = jest.fn();
    const onNegotiateItem = jest.fn();
    const onBulkNegotiate = jest.fn();
    const triggerHaptic = jest.fn();

    render(
      <NegotiationWarningModal
        visible
        pendingItem={cartItem}
        onClose={onClose}
        onNegotiateItem={onNegotiateItem}
        onBulkNegotiate={onBulkNegotiate}
        triggerHaptic={triggerHaptic}
        colors={Colors.light}
      />
    );

    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNegotiateItem).not.toHaveBeenCalled();
    expect(onBulkNegotiate).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalled();
  });

  it('disables bulk cart negotiation when a best-price item is in the cart', () => {
    const onBulkNegotiate = jest.fn();
    const triggerHaptic = jest.fn();
    render(
      <NegotiationWarningModal
        visible
        pendingItem={cartItem}
        hasNonNegotiableCartItem
        onClose={jest.fn()}
        onNegotiateItem={jest.fn()}
        onBulkNegotiate={onBulkNegotiate}
        triggerHaptic={triggerHaptic}
        colors={Colors.light}
      />
    );

    const bulkButton = screen.getByLabelText('Bulk negotiate entire cart');
    expect(bulkButton.props.accessibilityState).toMatchObject({
      disabled: true,
    });
    fireEvent.press(bulkButton);
    expect(onBulkNegotiate).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalled();
  });

  it('disables the item negotiation button when pending item is missing', () => {
    const onClose = jest.fn();
    const onNegotiateItem = jest.fn();
    const onBulkNegotiate = jest.fn();
    const triggerHaptic = jest.fn();

    render(
      <NegotiationWarningModal
        visible
        pendingItem={null}
        onClose={onClose}
        onNegotiateItem={onNegotiateItem}
        onBulkNegotiate={onBulkNegotiate}
        triggerHaptic={triggerHaptic}
        colors={Colors.light}
      />
    );

    const negotiateButton = screen.getByLabelText('Negotiate this item');
    expect(negotiateButton.props.accessibilityState).toMatchObject({
      disabled: true,
    });
    fireEvent.press(negotiateButton);
    expect(onNegotiateItem).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalled();
  });

  it('reports native dismissal through onDismissed', () => {
    // Regression: the host must keep the cart ad suppressed until the fade
    // dismissal actually completes, not just until the close handler runs.
    const onDismissed = jest.fn();
    const { UNSAFE_getByType } = render(
      <NegotiationWarningModal
        visible
        pendingItem={cartItem}
        onClose={jest.fn()}
        onDismissed={onDismissed}
        onNegotiateItem={jest.fn()}
        onBulkNegotiate={jest.fn()}
        triggerHaptic={jest.fn()}
        colors={Colors.light}
      />
    );

    act(() => {
      UNSAFE_getByType(Modal).props.onDismiss();
    });

    expect(onDismissed).toHaveBeenCalledTimes(1);
  });
});
