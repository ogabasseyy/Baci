import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors, { BRAND } from '@/constants/Colors';
import SearchResultsHeader from './SearchResultsHeader';

function renderHeader(
  overrides: Partial<ComponentProps<typeof SearchResultsHeader>> = {}
) {
  const props: ComponentProps<typeof SearchResultsHeader> = {
    colors: Colors.light,
    onBack: jest.fn(),
    onClearQuery: jest.fn(),
    onQueryChange: jest.fn(),
    onSubmitQuery: jest.fn(),
    query: '',
    ...overrides,
  };

  return render(<SearchResultsHeader {...props} />);
}

describe('SearchResultsHeader', () => {
  it('wires back, clear, submit, and typing actions', () => {
    const props = {
      onBack: jest.fn(),
      onClearQuery: jest.fn(),
      onSubmitQuery: jest.fn(),
      onQueryChange: jest.fn(),
      query: 'phone',
    };

    renderHeader(props);

    fireEvent.press(screen.getByLabelText('Go back'));
    fireEvent.press(screen.getByLabelText('Clear search'));

    const input = screen.getByPlaceholderText('Search or ask a question…');
    fireEvent.changeText(input, 'phone case');
    fireEvent(input, 'submitEditing');

    expect(props.onBack).toHaveBeenCalled();
    expect(props.onClearQuery).toHaveBeenCalled();
    expect(props.onQueryChange).toHaveBeenCalledWith('phone case');
    expect(props.onSubmitQuery).toHaveBeenCalled();
  });

  it('hides the clear action when the input is empty', () => {
    renderHeader({ query: '' });

    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  it('shows searchable-term guidance when the rejected input already meets the length rule', () => {
    renderHeader({ query: '!!', showMinLengthHint: true });

    expect(
      screen.getByLabelText('Type letters or numbers to search')
    ).toBeTruthy();
    expect(
      screen.queryByLabelText('Type at least 2 characters to search')
    ).toBeNull();
  });

  it('shows length guidance when the rejected input is too short', () => {
    renderHeader({ query: 'i', showMinLengthHint: true });

    expect(
      screen.getByLabelText('Type at least 2 characters to search')
    ).toBeTruthy();
  });

  it('hides the hint by default', () => {
    renderHeader({ query: '!!' });

    expect(
      screen.queryByLabelText('Type at least 2 characters to search')
    ).toBeNull();
  });
});
it('keeps a single controlled input while the keyboard dock changes size', () => {
  const props = {
    colors: Colors.light,
    query: 'iphone',
    onBack: jest.fn(),
    onClearQuery: jest.fn(),
    onQueryChange: jest.fn(),
    onSubmitQuery: jest.fn(),
  };
  const { rerender } = render(
    <SearchResultsHeader {...props} availableHeight={844} />
  );
  fireEvent.changeText(screen.getByLabelText('Search products'), 'iphone 15');
  rerender(
    <SearchResultsHeader {...props} query="iphone 15" availableHeight={390} />
  );
  expect(screen.getAllByLabelText('Search products')).toHaveLength(1);
  expect(screen.getByDisplayValue('iphone 15')).toBeTruthy();
  fireEvent(screen.getByLabelText('Search products'), 'submitEditing');
  expect(props.onSubmitQuery).toHaveBeenCalledTimes(1);
});

it('uses a red outline and the search-or-question prompt', () => {
  renderHeader();
  expect(screen.getByPlaceholderText('Search or ask a question…')).toBeTruthy();
  expect(screen.getByTestId('search-input-outline')).toHaveStyle({
    borderColor: BRAND.primary,
    borderWidth: 2,
  });
});
