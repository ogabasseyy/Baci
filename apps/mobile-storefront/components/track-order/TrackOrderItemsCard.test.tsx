import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { TrackOrderItemsCard } from './TrackOrderItemsCard';

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

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
        testID: testID ?? 'track-order-product-image',
        autoplay,
        accessible: true,
        accessibilityRole: 'image',
        accessibilityLabel: accessibilityLabel ?? 'track order product image',
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

describe('TrackOrderItemsCard', () => {
  it('renders item names and prices', () => {
    render(
      <TrackOrderItemsCard
        colors={Colors.light}
        currency="NGN"
        items={[
          {
            id: 'item-1',
            product_id: 'product-1',
            product_name: 'Test Phone',
            quantity: 1,
            unit_price: 150000,
            total_price: 150000,
            product_image: 'https://example.com/phone.gif',
          },
        ]}
      />
    );

    expect(screen.getByText('Test Phone')).toBeTruthy();
  });

  describe('bugfix: animated order product images on tracking', () => {
    it('does not autoplay product images in track-order details', () => {
      render(
        <TrackOrderItemsCard
          colors={Colors.light}
          currency="NGN"
          items={[
            {
              id: 'item-1',
              product_id: 'product-1',
              product_name: 'Test Phone',
              quantity: 1,
              unit_price: 150000,
              total_price: 150000,
              product_image: 'https://example.com/phone.gif',
            },
          ]}
        />
      );

      expect(
        screen.getByRole('image', { name: 'track order product image' }).props
          .autoplay
      ).toBe(false);
    });
  });
});
