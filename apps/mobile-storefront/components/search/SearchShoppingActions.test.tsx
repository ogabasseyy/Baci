import {
  fireEvent,
  render as renderNative,
  screen,
} from '@testing-library/react-native';
import type { ReactElement } from 'react';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import { SearchCompareButton } from './SearchComparisonControls';
import { SearchComparisonSession } from './SearchComparisonSession';
import { SearchShoppingActions } from './SearchShoppingActions';

function render(ui: ReactElement) {
  return renderNative(
    <SearchComparisonSession scope="iphone">{ui}</SearchComparisonSession>
  );
}

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
const mockToggle = jest.fn();
let mockProducts: Product[] = [];
jest.mock('@/stores/comparison-store', () => ({
  useComparisonStore: (selector: (state: unknown) => unknown) =>
    selector({ products: mockProducts, toggleComparison: mockToggle }),
}));
const product = { id: 'p1', name: 'iPhone' } as Product;
beforeEach(() => {
  mockProducts = [];
  mockToggle.mockClear();
  mockPush.mockClear();
});
it('keeps only the cart icon in idle search and preserves saved comparison selections', () => {
  mockProducts = [product, { id: 'p2', name: 'Samsung' } as Product];
  render(<SearchShoppingActions colors={Colors.light} />);
  expect(screen.queryByLabelText('Compare selected products (2)')).toBeNull();
  expect(screen.getByLabelText(/View cart/)).toBeTruthy();
  expect(screen.queryByText(/Cart .*→/)).toBeNull();
  expect(mockProducts).toHaveLength(2);
});
it('shows the header comparison action only after Compare is tapped', () => {
  mockProducts = [product, { id: 'p2', name: 'Samsung' } as Product];
  render(
    <>
      <SearchCompareButton product={product} colors={Colors.light} />
      <SearchShoppingActions colors={Colors.light} showComparison />
    </>
  );
  expect(screen.queryByLabelText('Compare selected products (2)')).toBeNull();
  fireEvent.press(screen.getByLabelText('Compare iPhone'));
  fireEvent.press(screen.getByLabelText('Compare selected products (2)'));
  expect(mockPush).toHaveBeenCalledWith('/compare');
});

it('resets the explicit comparison intent for a new query without discarding selections', () => {
  mockProducts = [product, { id: 'p2' } as Product];
  const controls = (
    <>
      <SearchCompareButton product={product} colors={Colors.light} />
      <SearchShoppingActions colors={Colors.light} showComparison />
    </>
  );
  const view = renderNative(
    <SearchComparisonSession scope="iphone">{controls}</SearchComparisonSession>
  );
  fireEvent.press(screen.getByLabelText('Compare iPhone'));
  expect(screen.getByLabelText('Compare selected products (2)')).toBeTruthy();
  view.rerender(
    <SearchComparisonSession scope="samsung">
      {controls}
    </SearchComparisonSession>
  );
  expect(screen.queryByLabelText('Compare selected products (2)')).toBeNull();
  view.rerender(
    <SearchComparisonSession scope="iphone">{controls}</SearchComparisonSession>
  );
  expect(screen.queryByLabelText('Compare selected products (2)')).toBeNull();
  expect(mockProducts).toHaveLength(2);
});
