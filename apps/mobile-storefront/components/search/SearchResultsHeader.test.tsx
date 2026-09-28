import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
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

    const input = screen.getByPlaceholderText('Search products...');
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
});
