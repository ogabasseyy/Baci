import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SearchRefinementToolbar } from './SearchRefinementToolbar';

const props = {
  criteria: { brands: [], sort: 'relevance' as const },
  categories: [],
  processors: [],
  colors: Colors.light,
  chipsCount: 0,
  filtersExpandedKey: null,
  onOpenSort: jest.fn(),
  onOpenFilters: jest.fn(),
};
describe('search refinement toolbar', () => {
  it('renders quick pills with the current sort label and filter count', () => {
    const view = render(
      <SearchRefinementToolbar
        {...props}
        criteria={{ brands: ['Apple'], sort: 'price_asc' }}
        chipsCount={2}
      />
    );
    expect(view.getByText('Price: low to high')).toBeTruthy();
    expect(view.getByText('Filters (2)')).toBeTruthy();
    expect(view.getByLabelText('Price')).toBeTruthy();
  });
  it('routes pill, sort, and filter presses to the panel opener', () => {
    const onOpenSort = jest.fn();
    const onOpenFilters = jest.fn();
    const view = render(
      <SearchRefinementToolbar
        {...props}
        onOpenSort={onOpenSort}
        onOpenFilters={onOpenFilters}
      />
    );
    fireEvent.press(view.getByLabelText('Sort'));
    expect(onOpenSort).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByLabelText('Filters'));
    expect(onOpenFilters).toHaveBeenCalledWith();
    fireEvent.press(view.getByLabelText('Price'));
    expect(onOpenFilters).toHaveBeenCalledWith('price');
  });
  it('marks only the expanded quick pill', () => {
    const view = render(
      <SearchRefinementToolbar {...props} filtersExpandedKey="price" />
    );
    expect(view.getByLabelText('Price').props.accessibilityState.expanded).toBe(
      true
    );
    expect(view.getByLabelText('Brand').props.accessibilityState.expanded).toBe(
      false
    );
  });
});
