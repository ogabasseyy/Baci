import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import CartStateView from './CartStateView';

jest.mock('@/components/storefront/GadgetPattern', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    GadgetPattern: () => <Text>GadgetPattern</Text>,
  };
});

describe('CartStateView', () => {
  it('renders the unavailable state and invokes retry', () => {
    const onRetry = jest.fn();
    const onStartShopping = jest.fn();

    render(
      <CartStateView
        variant="error"
        colorScheme="light"
        colors={Colors.light}
        isRetrying={false}
        onRetry={onRetry}
        onStartShopping={onStartShopping}
      />
    );

    expect(screen.getByText('Unable to load cart')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Retry loading cart' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onStartShopping).not.toHaveBeenCalled();
  });

  it('disables the retry action while recovery is in progress', () => {
    const onRetry = jest.fn();

    render(
      <CartStateView
        variant="error"
        colorScheme="light"
        colors={Colors.light}
        isRetrying
        onRetry={onRetry}
        onStartShopping={jest.fn()}
      />
    );

    const retryButton = screen.getByRole('button', {
      name: 'Retry loading cart',
    });
    expect(screen.getByText('Retrying...')).toBeTruthy();
    expect(retryButton.props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    fireEvent.press(retryButton);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('renders the empty state and invokes shopping navigation', () => {
    const onStartShopping = jest.fn();

    render(
      <CartStateView
        variant="empty"
        colorScheme="dark"
        colors={Colors.dark}
        isRetrying={false}
        onRetry={jest.fn()}
        onStartShopping={onStartShopping}
      />
    );

    expect(screen.getByText('Your cart is empty 🛒')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Start shopping' }));
    expect(onStartShopping).toHaveBeenCalledTimes(1);
  });
});
