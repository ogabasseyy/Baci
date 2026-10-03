import {
  fireEvent,
  render as renderNative,
  screen,
} from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import {
  SearchCompareButton,
  SearchShoppingActions,
} from './SearchComparisonControls';
import { SearchComparisonSession } from './SearchComparisonSession';

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
it('selects a real product for comparison without invoking purchase', () => {
  render(<SearchCompareButton product={product} colors={Colors.light} />);
  fireEvent.press(screen.getByLabelText('Compare iPhone'));
  expect(mockToggle).toHaveBeenCalledWith(product);
});
it('explains the existing three-product limit without replacing a selection', () => {
  mockProducts = ['a', 'b', 'c'].map((id) => ({ id }) as Product);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<SearchCompareButton product={product} colors={Colors.light} />);
  fireEvent.press(screen.getByLabelText('Compare iPhone'));
  expect(mockToggle).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Comparison full',
    'Remove one product before adding another. You can compare up to 3 products.',
    expect.arrayContaining([
      expect.objectContaining({ text: 'View comparison' }),
    ])
  );
  const buttons = alert.mock.calls[0][2] as {
    text: string;
    onPress?: () => void;
  }[];
  buttons.find((button) => button.text === 'View comparison')?.onPress?.();
  expect(mockPush).toHaveBeenCalledWith('/compare');
  alert.mockRestore();
});

it('shows the next action beside a selected card once two products are chosen', () => {
  mockProducts = [product, { id: 'p2', name: 'Samsung' } as Product];
  render(<SearchCompareButton product={product} colors={Colors.light} />);
  expect(screen.getByText('✓ Added to comparison')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'View comparison (2)' })
  ).toBeNull();
  fireEvent.press(screen.getByLabelText('Compare iPhone'));
  fireEvent.press(screen.getByRole('button', { name: 'View comparison (2)' }));
  expect(mockPush).toHaveBeenCalledWith('/compare');
});
it('does not offer a comparison page with only one selection', () => {
  mockProducts = [product];
  render(<SearchCompareButton product={product} colors={Colors.light} />);
  expect(
    screen.queryByRole('button', { name: 'View comparison (1)' })
  ).toBeNull();
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
