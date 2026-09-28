import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPageRetryButton } from './search-page-retry-button';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

describe('SearchPageRetryButton', () => {
  it('refreshes the current route instead of navigating to the same URL', () => {
    render(<SearchPageRetryButton />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
