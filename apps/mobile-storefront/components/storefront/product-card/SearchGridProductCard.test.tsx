import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { Product } from '@/types/product';
import SearchGridProductCard from './SearchGridProductCard';
import type { GridProductCardProps } from './types';

jest.mock('expo-image', () => ({ Image: 'Image' }));
const product = {
  id: 'p1',
  name: 'iPhone 13',
  slug: 'iphone-13',
  price: 350000,
  image: 'https://example.com/phone.jpg',
  specifications: { storage: '128 GB' },
} as Product;
const props: GridProductCardProps = {
  product,
  imageSource: { uri: product.image },
  imageProps: {},
  showLocalPlaceholder: false,
  handlePress: jest.fn(),
  handleAnimateIn: jest.fn(),
  handleAnimateOut: jest.fn(),
  handleWishlistPress: jest.fn(),
  handleAddToCart: jest.fn(),
  isSaved: false,
  cartItemCount: 0,
  animatedStyle: {},
  heartAnimatedStyle: {},
  gridWidth: 180,
  shadowColor: '#000',
  footer: <Text>Compare</Text>,
};
it('shows product text immediately without Details or No ratings and keeps purchase separate', () => {
  render(<SearchGridProductCard {...props} />);
  expect(screen.getByText('128 GB')).toBeTruthy();
  expect(screen.getByText('Compare')).toBeTruthy();
  expect(screen.queryByText('Details')).toBeNull();
  expect(screen.queryByText('No ratings')).toBeNull();
  fireEvent.press(screen.getByLabelText('Add iPhone 13 to cart'));
  expect(props.handleAddToCart).toHaveBeenCalled();
  expect(props.handlePress).not.toHaveBeenCalled();
});
it('labels option selection honestly for matched search prices', () => {
  render(
    <SearchGridProductCard
      {...props}
      product={{
        ...product,
        searchMatch: {
          productId: 'p1',
          total: 1,
          price: 300000,
          condition: 'used',
        },
      }}
    />
  );
  expect(screen.getByLabelText('Choose options for iPhone 13')).toBeTruthy();
  expect(screen.queryByLabelText('Add iPhone 13 to cart')).toBeNull();
});
