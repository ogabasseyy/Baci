import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { CartItem } from '@/stores/cart-store';
import { useCartNegotiation } from './use-cart-negotiation';

const mockOpenNegotiation = jest.fn();
const mockClearNegotiatedPrice = jest.fn();

type MockAlertButton = {
  text: string;
  style?: string;
  onPress?: () => void;
};

jest.mock('zustand/react/shallow', () => ({
  useShallow: <T>(selector: T) => selector,
}));

jest.mock('@/stores/ui-store', () => ({
  useUIStore: (
    selector: (state: {
      openNegotiation: typeof mockOpenNegotiation;
    }) => unknown
  ) => selector({ openNegotiation: mockOpenNegotiation }),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (
    selector: (state: {
      clearNegotiatedPrice: typeof mockClearNegotiatedPrice;
    }) => unknown
  ) => selector({ clearNegotiatedPrice: mockClearNegotiatedPrice }),
}));

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

describe('useCartNegotiation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // no-op: suppress native alert during tests
    });
  });

  it('flags hasNonNegotiableCartItem when a non-negotiable item is in the cart', () => {
    // Arrange
    const items = [
      createItem(),
      createItem({ id: 'cart-2', brand: 'Tecno', name: 'Tecno Spark 50' }),
    ];

    // Act
    const { result } = renderHook(() =>
      useCartNegotiation({ items, grandTotal: 1000000 })
    );

    // Assert
    expect(result.current.hasNonNegotiableCartItem).toBe(true);
  });

  it('does not flag hasNonNegotiableCartItem when all items are negotiable', () => {
    // Arrange
    const items = [
      createItem(),
      createItem({ id: 'cart-2', brand: 'Apple', name: 'iPhone 15' }),
    ];

    // Act
    const { result } = renderHook(() =>
      useCartNegotiation({ items, grandTotal: 1000000 })
    );

    // Assert
    expect(result.current.hasNonNegotiableCartItem).toBe(false);
  });

  it('alerts and skips negotiation for a non-negotiable item', () => {
    // Arrange
    const nonNegotiable = createItem({
      brand: 'Tecno',
      name: 'Tecno Spark 50',
    });
    const { result } = renderHook(() =>
      useCartNegotiation({ items: [nonNegotiable], grandTotal: 500000 })
    );

    // Act
    act(() => {
      result.current.openItemNegotiation(nonNegotiable);
    });

    // Assert
    expect(Alert.alert).toHaveBeenCalledWith(
      'Best Price',
      'This item is already at the best price.'
    );
    expect(mockOpenNegotiation).not.toHaveBeenCalled();
  });

  it('alerts and skips cart-wide negotiation when a non-negotiable line is present', () => {
    // Arrange
    const items = [
      createItem(),
      createItem({ id: 'cart-2', brand: 'Tecno', name: 'Tecno Spark 50' }),
    ];
    const { result } = renderHook(() =>
      useCartNegotiation({ items, grandTotal: 1000000 })
    );

    // Act
    act(() => {
      result.current.openTotalNegotiation();
    });

    // Assert
    expect(Alert.alert).toHaveBeenCalledWith(
      'Best Price Item in Cart',
      'Cart-wide negotiation is unavailable while your cart includes a best-price item.'
    );
    expect(mockOpenNegotiation).not.toHaveBeenCalled();
  });

  it('uses the validated cart effective price when reopening item negotiation', () => {
    // Arrange
    const acceptedItem = createItem({
      brand: 'Tecno',
      name: 'Tecno Spark 50',
      negotiatedPrice: 490000,
      negotiationStatus: 'accepted',
    });
    const { result } = renderHook(() =>
      useCartNegotiation({ items: [acceptedItem], grandTotal: 490000 })
    );

    // Act
    act(() => {
      result.current.actuallyOpenItemNegotiation(acceptedItem);
    });

    // Assert
    expect(mockOpenNegotiation).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPrice: 500000,
      })
    );
  });

  it('routes a negotiable item to openNegotiation via the warning confirmation', () => {
    // Arrange
    const negotiable = createItem({
      condition: 'used',
      slug: 'iphone-13-pro',
      variant_attributes: { color: 'Graphite', storage: '256GB' },
      variant_id: 'variant-graphite-256',
      variant_name: 'Graphite / 256GB',
    });
    const { result } = renderHook(() =>
      useCartNegotiation({ items: [negotiable], grandTotal: 500000 })
    );

    // Act — first request shows the warning, no negotiation yet
    act(() => {
      result.current.openItemNegotiation(negotiable);
    });

    // Assert — warning state primed
    expect(result.current.showNegotiateWarning).toBe(true);
    expect(result.current.pendingNegotiateItem).toBe(negotiable);
    expect(mockOpenNegotiation).not.toHaveBeenCalled();

    // Act — confirming opens the negotiation modal
    act(() => {
      result.current.actuallyOpenItemNegotiation(negotiable);
    });

    // Assert
    expect(mockOpenNegotiation).toHaveBeenCalledWith({
      type: 'single',
      itemId: negotiable.id,
      productName: negotiable.name,
      currentPrice: negotiable.price * negotiable.quantity,
      brand: negotiable.brand,
      isNegotiable: true,
      productSlug: 'iphone-13-pro',
      variantId: 'variant-graphite-256',
      variantName: 'Graphite / 256GB',
      variantAttributes: { color: 'Graphite', storage: '256GB' },
      condition: 'used',
    });
    expect(result.current.showNegotiateWarning).toBe(false);
    expect(result.current.pendingNegotiateItem).toBeNull();
  });

  it('alerts and skips item negotiation when a bulk discount is active', () => {
    // Arrange
    const discountedItem = createItem({
      cartDiscount: 2500,
    } as Partial<CartItem>);
    const { result } = renderHook(() =>
      useCartNegotiation({ items: [discountedItem], grandTotal: 500000 })
    );

    // Act
    act(() => {
      result.current.openItemNegotiation(discountedItem);
    });

    // Assert
    expect(Alert.alert).toHaveBeenCalledWith(
      'Bulk Discount Active',
      'You already have a bulk discount applied. Remove it before negotiating items individually.'
    );
    expect(mockOpenNegotiation).not.toHaveBeenCalled();
    expect(result.current.showNegotiateWarning).toBe(false);
    expect(result.current.pendingNegotiateItem).toBeNull();
  });

  it('clears individual negotiated prices before cart-wide negotiation', () => {
    // Arrange
    const negotiatedLine = createItem({ negotiatedPrice: 490000 });
    const { result } = renderHook(() =>
      useCartNegotiation({ items: [negotiatedLine], grandTotal: 490000 })
    );

    // Act
    act(() => {
      result.current.openTotalNegotiation();
    });

    // Assert
    expect(Alert.alert).toHaveBeenCalledWith(
      'Reset individual prices?',
      'Negotiating your whole cart will clear the prices you negotiated on individual items. Reset them and continue?',
      expect.any(Array)
    );
    expect(mockOpenNegotiation).not.toHaveBeenCalled();

    const buttons = (Alert.alert as jest.Mock).mock.calls[0]?.[2] as
      | MockAlertButton[]
      | undefined;
    // Find the confirm button by label rather than position so the test does
    // not break if the button order changes.
    const confirmButton = buttons?.find((b) => b.text === 'Reset & Continue');

    act(() => {
      confirmButton?.onPress?.();
    });

    expect(mockClearNegotiatedPrice).toHaveBeenCalledWith(negotiatedLine.id);
    expect(mockOpenNegotiation).toHaveBeenCalledWith({
      type: 'total',
      productName: 'Total Cart',
      currentPrice: 500000,
      isNegotiable: true,
    });
  });

  it('opens cart-wide negotiation when every line is negotiable', () => {
    // Arrange
    const items = [createItem(), createItem({ id: 'cart-2' })];
    const { result } = renderHook(() =>
      useCartNegotiation({ items, grandTotal: 1000000 })
    );

    // Act
    act(() => {
      result.current.openTotalNegotiation();
    });

    // Assert
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockOpenNegotiation).toHaveBeenCalledWith({
      type: 'total',
      productName: 'Total Cart',
      currentPrice: 1000000,
      isNegotiable: true,
    });
  });
});
