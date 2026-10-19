import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CartEmptyState } from './CartEmptyState';

jest.mock('@/components/cart/SharedCartStatusPanel', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    SharedCartStatusPanel: () => <MockText>SharedCartStatusPanel</MockText>,
  };
});

jest.mock('@/components/cart/NativeCartAccountPanel', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    NativeCartAccountPanel: () => <MockText>NativeCartAccountPanel</MockText>,
  };
});

jest.mock('@/components/storefront/GadgetPattern', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    GadgetPattern: () => <MockText>GadgetPattern</MockText>,
  };
});

describe('CartEmptyState', () => {
  it('mounts the status and account panels above the empty state', () => {
    const onStartShopping = jest.fn();

    render(
      <CartEmptyState
        colorScheme="light"
        colors={Colors.light}
        onRetry={jest.fn()}
        onStartShopping={onStartShopping}
      />
    );

    expect(screen.getByText('SharedCartStatusPanel')).toBeTruthy();
    expect(screen.getByText('NativeCartAccountPanel')).toBeTruthy();
    expect(screen.getByText('Your cart is empty 🛒')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Start shopping' }));
    expect(onStartShopping).toHaveBeenCalledTimes(1);
  });
});
