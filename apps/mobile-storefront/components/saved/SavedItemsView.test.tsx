import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import Colors from '@/constants/Colors';
import type { SavedItem } from '@/stores/saved-store';
import { SavedItemsView } from './SavedItemsView';

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListEmptyComponent,
  }: {
    data: SavedItem[];
    renderItem: (info: { item: SavedItem }) => ReactNode;
    ListHeaderComponent?: () => ReactNode;
    ListEmptyComponent?: () => ReactNode;
  }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');

    return (
      <View>
        {ListHeaderComponent?.()}
        {data.length === 0
          ? ListEmptyComponent?.()
          : data.map((item) => (
              <View key={item.id}>{renderItem({ item })}</View>
            ))}
      </View>
    );
  },
}));

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: ({
      autoplay,
      accessibilityLabel,
      testID,
    }: {
      autoplay?: boolean;
      accessibilityLabel?: string;
      testID?: string;
    }) => {
      const viewProps = {
        testID: testID ?? 'saved-item-image',
        accessibilityLabel: accessibilityLabel ?? 'saved item image',
        accessibilityRole: 'image' as const,
        autoplay,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: jest.requireActual<typeof import('react-native')>('react-native')
      .View,
  },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  Layout: { springify: () => ({}) },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/storefront/ProductCard', () => ({
  BLURHASH_VARIANTS: { default: 'placeholder' },
}));

const makeSavedItem = (overrides: Partial<SavedItem> = {}): SavedItem => ({
  id: 'item-1',
  product_id: 'product-1',
  name: 'Test Phone',
  slug: 'test-phone',
  price: 100000,
  image: 'https://example.com/phone.png',
  savedAt: Date.UTC(2026, 4, 24),
  ...overrides,
});

describe('SavedItemsView', () => {
  const props = {
    colors: Colors.light,
    items: [] as SavedItem[],
    onAddToCart: jest.fn(),
    onBrowseProducts: jest.fn(),
    onClearAll: jest.fn(),
    onProductPress: jest.fn(),
    onRemove: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the empty state and browses products from its primary action', () => {
    render(<SavedItemsView {...props} />);

    expect(screen.getByText('No saved items')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Browse Products' }));

    expect(props.onBrowseProducts).toHaveBeenCalledTimes(1);
  });

  it('renders saved products and exposes labeled product actions', () => {
    const item = makeSavedItem({ brand: 'Baci', compare_at_price: 125000 });

    render(<SavedItemsView {...props} items={[item]} />);

    expect(screen.getByText('1 item saved')).toBeTruthy();
    expect(screen.getByText('Test Phone')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'View Test Phone' }));
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Remove Test Phone from saved items',
      })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Add Test Phone to cart' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Clear saved items' }));

    expect(props.onProductPress).toHaveBeenCalledWith(item);
    expect(props.onRemove).toHaveBeenCalledWith(item);
    expect(props.onAddToCart).toHaveBeenCalledWith(item);
    expect(props.onClearAll).toHaveBeenCalledTimes(1);
  });

  describe('bugfix: animated catalog images on saved surfaces', () => {
    it('does not autoplay product images in the saved list', () => {
      render(
        <SavedItemsView
          {...props}
          items={[makeSavedItem({ image: 'https://example.com/phone.gif' })]}
        />
      );

      // Nested under a Pressable button, so role queries hide the image.
      expect(screen.getByTestId('saved-item-image').props.autoplay).toBe(false);
    });
  });
});
