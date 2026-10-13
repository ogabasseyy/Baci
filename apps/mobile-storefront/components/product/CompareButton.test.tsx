import { fireEvent, render, screen } from '@testing-library/react-native';
import { useComparisonStore } from '@/stores/comparison-store';
import type { Product } from '@/types/product';
import { CompareButton } from './CompareButton';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/stores/comparison-store', () => ({
  useComparisonStore: jest.fn(),
}));

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: 'Ionicons',
}));

type MockComparisonState = {
  canAdd: () => boolean;
  isInComparison: (id: string) => boolean;
  toggleComparison: (p: Product) => void;
};

describe('CompareButton', () => {
  const mockProduct = {
    id: 'prod-123',
    name: 'Test Product',
    price: 1000,
  } as unknown as Product;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly when product is NOT in comparison', () => {
    (useComparisonStore as unknown as jest.Mock).mockImplementation(
      (selector: unknown) => {
        const state: MockComparisonState = {
          canAdd: () => true,
          isInComparison: () => false,
          toggleComparison: jest.fn(),
        };
        return (selector as (s: MockComparisonState) => unknown)(state);
      }
    );

    render(<CompareButton product={mockProduct} />);

    const button = screen.getByRole('button');
    expect(button.props.accessibilityLabel).toBe('Add to comparison');
    expect(button.props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByText('Compare')).toBeTruthy();
  });

  it('renders correctly when product IS in comparison', () => {
    (useComparisonStore as unknown as jest.Mock).mockImplementation(
      (selector: unknown) => {
        const state: MockComparisonState = {
          canAdd: () => true,
          isInComparison: () => true,
          toggleComparison: jest.fn(),
        };
        return (selector as (s: MockComparisonState) => unknown)(state);
      }
    );

    render(<CompareButton product={mockProduct} />);

    const button = screen.getByRole('button');
    expect(button.props.accessibilityLabel).toBe('Remove from comparison');
    expect(button.props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByText('Added')).toBeTruthy();
  });

  it('calls toggleComparison when pressed', () => {
    const mockToggle = jest.fn();
    (useComparisonStore as unknown as jest.Mock).mockImplementation(
      (selector: unknown) => {
        const state: MockComparisonState = {
          canAdd: () => true,
          isInComparison: () => false,
          toggleComparison: mockToggle,
        };
        return (selector as (s: MockComparisonState) => unknown)(state);
      }
    );

    render(<CompareButton product={mockProduct} />);

    const button = screen.getByRole('button');
    fireEvent.press(button);

    expect(mockToggle).toHaveBeenCalledWith(mockProduct);
  });
});
