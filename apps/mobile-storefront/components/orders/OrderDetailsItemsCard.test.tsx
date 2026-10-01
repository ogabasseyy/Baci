import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { OrderDetailsItemsCard } from './OrderDetailsItemsCard';

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
        testID,
        autoplay,
        accessible: true,
        accessibilityRole: 'image',
        accessibilityLabel,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

describe('OrderDetailsItemsCard', () => {
  const renderItemsCard = (
    item: Partial<Parameters<typeof OrderDetailsItemsCard>[0]['items'][number]>
  ) =>
    render(
      <OrderDetailsItemsCard
        colors={Colors.light}
        items={[
          {
            id: 'item-1',
            product_id: 'product-1',
            product_name: '13" MacBook Air M2 (2022)',
            product_slug: 'macbook-air-m2',
            quantity: 1,
            price: 690000,
            ...item,
          },
        ]}
        onOpenProduct={jest.fn()}
      />
    );

  it('renders selected condition and variant metadata under the product name', () => {
    renderItemsCard({ condition: 'open_box', variant_name: '512GB' });

    expect(screen.getByText('Open Box / 512GB')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'View 13" MacBook Air M2 (2022), Open Box / 512GB details'
      )
    ).toBeTruthy();
  });

  it('renders condition-only metadata', () => {
    renderItemsCard({ condition: 'open_box' });

    expect(screen.getByText('Open Box')).toBeTruthy();
  });

  it('renders variant-only metadata', () => {
    renderItemsCard({ variant_name: '512GB' });

    expect(screen.getByText('512GB')).toBeTruthy();
  });

  it('omits the option label when no condition or variant is present', () => {
    renderItemsCard({});

    expect(screen.queryByText('Open Box')).toBeNull();
    expect(screen.queryByText('512GB')).toBeNull();
  });

  describe('bugfix: animated order product images', () => {
    it('does not autoplay product images in order details', () => {
      renderItemsCard({
        image_url: 'https://example.com/product.gif',
      });

      expect(
        screen.getByRole('image', {
          name: '13" MacBook Air M2 (2022) image',
        }).props.autoplay
      ).toBe(false);
    });
  });
});
