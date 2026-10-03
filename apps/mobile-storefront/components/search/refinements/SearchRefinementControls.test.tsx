import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SearchRefinementControls } from './SearchRefinementControls';

const props = {
  criteria: { brands: [], sort: 'relevance' as const },
  brands: ['Apple', 'Samsung'],
  categories: [],
  colors: Colors.light,
  onCommit: jest.fn(),
};
describe('native search refinements', () => {
  it('collapses the applied-filter row until a filter is active', () => {
    const view = render(<SearchRefinementControls {...props} />);
    expect(view.queryByLabelText('Applied filters')).toBeNull();
    view.rerender(
      <SearchRefinementControls
        {...props}
        criteria={{ ...props.criteria, minPrice: 1 }}
      />
    );
    expect(view.getByLabelText('Applied filters')).toBeTruthy();
  });
  it('opens the quick Price pill and exposes its expanded state', () => {
    const view = render(<SearchRefinementControls {...props} />);
    expect(view.getByLabelText('Sort')).toBeTruthy();
    expect(view.getByLabelText('Filters')).toBeTruthy();
    expect(view.getByLabelText('Price').props.accessibilityState.expanded).toBe(
      false
    );
    fireEvent.press(view.getByLabelText('Price'));
    expect(view.getByLabelText('Price').props.accessibilityState.expanded).toBe(
      true
    );
    expect(view.getByLabelText('Maximum price (₦)')).toBeTruthy();
  });
  it('uses concise quick-filter labels', () => {
    const view = render(<SearchRefinementControls {...props} />);
    for (const label of ['Price', 'Brand', 'Condition']) {
      expect(view.getByText(label)).toBeTruthy();
      expect(view.queryByText(`${label} filters`)).toBeNull();
    }
  });
  it('cancels drafted brand choices and applies combined brands once', () => {
    const commit = jest.fn();
    const view = render(
      <SearchRefinementControls {...props} onCommit={commit} />
    );
    fireEvent.press(view.getByLabelText('Filters'));
    fireEvent.press(view.getByLabelText('Brand options'));
    fireEvent.press(view.getByRole('checkbox', { name: 'Apple' }));
    expect(commit).not.toHaveBeenCalled();
    fireEvent.press(view.getByLabelText('Close filters'));
    fireEvent.press(view.getByLabelText('Filters'));
    fireEvent.press(view.getByLabelText('Brand options'));
    expect(
      view.getByRole('checkbox', { name: 'Apple' }).props.accessibilityState
        .checked
    ).toBe(false);
    fireEvent.press(view.getByRole('checkbox', { name: 'Apple' }));
    fireEvent.press(view.getByRole('checkbox', { name: 'Samsung' }));
    fireEvent.press(view.getByLabelText('Apply filters'));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({
      brands: ['Apple', 'Samsung'],
      sort: 'relevance',
    });
  });
  it('retains an explicit zero upper price', () => {
    const commit = jest.fn();
    const view = render(
      <SearchRefinementControls {...props} onCommit={commit} />
    );
    fireEvent.press(view.getByLabelText('Price'));
    fireEvent.changeText(view.getByLabelText('Maximum price (₦)'), '0');
    fireEvent.press(view.getByLabelText('Apply filters'));
    expect(commit).toHaveBeenCalledWith({
      brands: [],
      sort: 'relevance',
      maxPrice: 0,
    });
  });
  it('rejects a reversed price range without committing', () => {
    const commit = jest.fn();
    const view = render(
      <SearchRefinementControls {...props} onCommit={commit} />
    );
    fireEvent.press(view.getByLabelText('Price'));
    fireEvent.changeText(view.getByLabelText('Minimum price (₦)'), '300');
    fireEvent.changeText(view.getByLabelText('Maximum price (₦)'), '100');
    fireEvent.press(view.getByLabelText('Apply filters'));
    expect(view.getByRole('alert')).toBeTruthy();
    expect(commit).not.toHaveBeenCalled();
  });
});

it('keeps filter sheets compact with a scrollable body and an apply action', () => {
  const view = render(<SearchRefinementControls {...props} />);
  fireEvent.press(view.getByLabelText('Filters'));
  fireEvent.press(view.getByLabelText('Brand options'));
  const { height } = require('react-native').Dimensions.get('window');
  expect(view.getByTestId('search-refinement-panel')).toHaveStyle({
    maxHeight: height * 0.72,
    height: height * 0.72,
  });
  expect(view.getByLabelText('Apply filters')).toBeTruthy();
});

it('shows only available conditions in the compact condition group', () => {
  const view = render(
    <SearchRefinementControls
      {...props}
      brands={['Apple']}
      conditions={['used']}
    />
  );
  fireEvent.press(view.getByLabelText('Condition'));
  expect(view.getByRole('radio', { name: 'Used' })).toBeTruthy();
  expect(view.queryByRole('radio', { name: 'New' })).toBeNull();
  expect(view.queryByRole('checkbox', { name: 'Samsung' })).toBeNull();
});

it('offers query-backed processor and category quick groups and commits the processor', () => {
  const onCommit = jest.fn();
  const view = render(
    <SearchRefinementControls
      {...props}
      processors={['Intel Core i7', 'AMD Ryzen 5']}
      categories={[
        { id: '00000000-0000-4000-8000-000000000001', name: 'Laptops' },
        { id: '00000000-0000-4000-8000-000000000002', name: 'Gaming Laptops' },
      ]}
      onCommit={onCommit}
    />
  );
  expect(view.getByLabelText('Type')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Processor'));
  fireEvent.press(view.getByLabelText('Intel Core i7'));
  fireEvent.press(view.getByLabelText('Apply filters'));
  expect(onCommit).toHaveBeenCalledWith(
    expect.objectContaining({ processor: 'Intel Core i7' })
  );
});
