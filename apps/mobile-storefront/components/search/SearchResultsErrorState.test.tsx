import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import SearchResultsErrorState from './SearchResultsErrorState';

function renderErrorState(
  overrides: Partial<ComponentProps<typeof SearchResultsErrorState>> = {}
) {
  const props: ComponentProps<typeof SearchResultsErrorState> = {
    colors: Colors.light,
    committedQuery: '',
    isRetrying: false,
    onRetry: jest.fn(),
    ...overrides,
  };

  return render(<SearchResultsErrorState {...props} />);
}

describe('SearchResultsErrorState', () => {
  it('renders a retryable error without no-results copy', () => {
    const onRetry = jest.fn();

    renderErrorState({ committedQuery: 'iphone', onRetry });

    expect(screen.getByText("Couldn't load results")).toBeTruthy();
    expect(screen.queryByText('No results found')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Retry search' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the retry and shows progress while the retry is in flight', () => {
    const onRetry = jest.fn();

    renderErrorState({ committedQuery: 'iphone', isRetrying: true, onRetry });

    expect(screen.getByText('Retrying…')).toBeTruthy();
    expect(screen.getByTestId('retry-activity-indicator')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Retry search' }));
    expect(onRetry).not.toHaveBeenCalled();
  });
});
