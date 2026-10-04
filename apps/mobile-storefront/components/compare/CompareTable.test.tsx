import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { formatPrice, type Product } from '@/types/product';
import { CompareTable } from './CompareTable';

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: () => <View testID="compare-product-image" />,
  };
});

jest.mock('@/components/storefront/ProductCard', () => ({
  BLURHASH_VARIANTS: { default: 'blurhash' },
}));

const phone: Product = {
  id: 'phone-1',
  slug: 'phone-one',
  name: 'Phone One',
  price: 120000,
  compare_at_price: 150000,
  image: 'https://example.com/phone.png',
  brand: 'Baci',
  condition: 'new',
  rating: 4.5,
  specifications: { Storage: '256 GB' },
};

function createProps() {
  return {
    allSpecKeys: ['Storage'],
    bottomInset: 20,
    colors: Colors.light,
    onAddToCart: jest.fn(),
    onOpenProduct: jest.fn(),
    onRemoveProduct: jest.fn(),
    products: [phone],
  };
}

describe('CompareTable', () => {
  it('renders price, condition, rating, and spec rows with row actions', () => {
    const props = createProps();
    render(<CompareTable {...props} />);
    expect(screen.getByText('Phone One')).toBeTruthy();
    expect(screen.getByText('256 GB')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Remove Phone One from comparison' })
    );
    expect(props.onRemoveProduct).toHaveBeenCalledWith('phone-1');
    fireEvent.press(
      screen.getByRole('button', { name: 'View options for Phone One' })
    );
    expect(props.onAddToCart).toHaveBeenCalledWith(phone);
  });
  it('marks unverified options instead of their catalog values', () => {
    render(<CompareTable {...createProps()} unavailableIds={['phone-1']} />);
    expect(screen.getByText('Price not verified')).toBeTruthy();
    expect(screen.getByText('Option not verified')).toBeTruthy();
  });
  it('never renders the zero-price fallback as a real amount', () => {
    const props = createProps();
    render(
      <CompareTable
        {...props}
        products={[{ ...phone, price: 0 }]}
        unavailableIds={['phone-1']}
      />
    );
    expect(screen.getByText('Price not verified')).toBeTruthy();
    expect(screen.queryByText(formatPrice(0))).toBeNull();
  });
});
