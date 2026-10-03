import { fireEvent, render, screen } from '@testing-library/react-native';
import { SearchFilterBar } from './SearchFilterBar';

const props = {
  categories: ['All', 'Phones'],
  selectedCategory: 'All',
  onSelectCategory: jest.fn(),
  minPrice: 0,
  maxPrice: 3000000,
  onPriceChange: jest.fn(),
  brands: ['Apple', 'Samsung'],
  onBrandFilterVisible: jest.fn(),
  selectedBrand: 'All',
  onSelectBrand: jest.fn(),
  selectedCondition: 'All',
  onSelectCondition: jest.fn(),
  minRating: 0,
  onSelectRating: jest.fn(),
  viewMode: 'grid' as const,
  onViewModeChange: jest.fn(),
};

describe('Search filter sheets', () => {
  beforeEach(() => jest.clearAllMocks());
  it('opens brand options, selects the brand and closes with Done', () => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Brand' }));
    expect(props.onBrandFilterVisible).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Apple' }));
    expect(props.onSelectBrand).toHaveBeenCalledWith('Apple');
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Apple' })).toBeNull();
  });
  it('opens condition options and preserves selection', () => {
    render(<SearchFilterBar {...props} selectedCondition="Used" />);
    fireEvent.press(screen.getByRole('button', { name: 'Condition' }));
    expect(
      screen.getByRole('button', { name: 'Used' }).props.accessibilityState
        .selected
    ).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'New' }));
    expect(props.onSelectCondition).toHaveBeenCalledWith('New');
    fireEvent.press(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });
  it('opens keyboard-aware price inputs and delegates the price change', () => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Price' }));
    fireEvent.changeText(screen.getByLabelText('Min'), '50000');
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(props.onPriceChange).toHaveBeenCalledWith(50000, 3000000);
  });
  it('preserves category, rating and view controls', () => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Phones category' }));
    expect(props.onSelectCategory).toHaveBeenCalledWith('Phones');
    fireEvent.press(screen.getByRole('button', { name: 'List view' }));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
    fireEvent.press(screen.getByRole('button', { name: 'Rating' }));
    fireEvent.press(screen.getByRole('button', { name: '4+' }));
    expect(props.onSelectRating).toHaveBeenCalledWith(4);
  });
});
