import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { StickyBottomActions } from './StickyBottomActions';

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => ({ data: undefined }),
}));

const mockPrefetch = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    prefetch: (...args: unknown[]) => mockPrefetch(...args),
  },
}));

jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    default: { View },
    View,
    LinearTransition: {
      springify: () => ({
        damping: () => ({
          stiffness: () => ({}),
        }),
      }),
    },
  };
});

const defaultProps = {
  canPurchase: true,
  quantityInCart: 0,
  localQty: '1',
  onLocalQtyChange: jest.fn(),
  onLocalQtyBlur: jest.fn(),
  onDecrement: jest.fn(),
  onIncrement: jest.fn(),
  onAddToCart: jest.fn(),
  colors: Colors.light,
  paddingBottom: 16,
} as const;

describe('StickyBottomActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the add to cart CTA with stable row layout styles', () => {
    const { toJSON } = render(<StickyBottomActions {...defaultProps} />);

    const addToCartButton = screen.getByRole('button', { name: 'Add to Cart' });
    const flattenedStyle = StyleSheet.flatten(addToCartButton.props.style);
    const renderedTree = toJSON();
    const renderedRoot = Array.isArray(renderedTree)
      ? renderedTree[0]
      : renderedTree;
    const containerStyle = StyleSheet.flatten(renderedRoot?.props.style);

    expect(typeof addToCartButton.props.style).not.toBe('function');
    expect(flattenedStyle).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      width: '100%',
    });
    expect(containerStyle?.paddingBottom).toBe(16);
  });

  it('calls onAddToCart when the add to cart CTA is pressed', () => {
    render(<StickyBottomActions {...defaultProps} />);

    fireEvent.press(screen.getByRole('button', { name: 'Add to Cart' }));

    expect(defaultProps.onAddToCart).toHaveBeenCalledTimes(1);
  });

  it('renders a disabled out-of-stock CTA when purchase is not allowed', () => {
    render(<StickyBottomActions {...defaultProps} canPurchase={false} />);

    const button = screen.getByRole('button', { name: 'Product out of stock' });

    expect(button.props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText('Out of Stock')).toBeTruthy();
  });

  it('keeps add-to-cart copy readable in dark mode on the branded CTA background', () => {
    render(
      <StickyBottomActions
        {...defaultProps}
        colors={Colors.dark}
        quantityInCart={0}
      />
    );

    expect(
      StyleSheet.flatten(screen.getByText('Add to Cart').props.style)
    ).toMatchObject({
      color: Colors.dark.white,
    });
  });

  it('renders the active cart CTA with a stable view cart button layout', () => {
    render(
      <StickyBottomActions {...defaultProps} quantityInCart={2} localQty="2" />
    );

    const viewCartButton = screen.getByRole('button', { name: 'View Cart' });
    const quantityInput = screen.getByLabelText('Quantity in cart');
    const flattenedStyle = StyleSheet.flatten(viewCartButton.props.style);

    expect(typeof viewCartButton.props.style).not.toBe('function');
    expect(quantityInput).toBeTruthy();
    expect(flattenedStyle).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
    });
  });

  it('navigates to cart when the view cart CTA is pressed', () => {
    render(
      <StickyBottomActions {...defaultProps} quantityInCart={1} localQty="1" />
    );

    const viewCartButton = screen.getByRole('button', { name: 'View Cart' });

    fireEvent(viewCartButton, 'pressIn');
    fireEvent.press(viewCartButton);

    expect(mockPrefetch).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/cart');
  });

  it('uses the provided bottom inset padding instead of docking into the home indicator area', () => {
    const { toJSON } = render(
      <StickyBottomActions
        {...defaultProps}
        bottomOffset={34}
        paddingBottom={16}
      />
    );

    const renderedTree = toJSON();
    const renderedRoot = Array.isArray(renderedTree)
      ? renderedTree[0]
      : renderedTree;
    const containerStyle = StyleSheet.flatten(renderedRoot?.props.style);

    expect(containerStyle?.bottom).toBe(34);
    expect(containerStyle?.paddingBottom).toBe(16);
  });

  it('restores the add to cart CTA after the cart quantity drops back to zero', () => {
    const { rerender } = render(
      <StickyBottomActions {...defaultProps} quantityInCart={1} localQty="1" />
    );

    expect(screen.getByRole('button', { name: 'View Cart' })).toBeTruthy();

    rerender(
      <StickyBottomActions {...defaultProps} quantityInCart={0} localQty="0" />
    );

    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View Cart' })).toBeNull();
  });
});
