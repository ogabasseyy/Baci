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

    const button = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(button);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    // The mocked refresh settles synchronously, so the pending state
    // clears and the button is interactive again for a later retry.
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toBe('Try again');
  });
});
