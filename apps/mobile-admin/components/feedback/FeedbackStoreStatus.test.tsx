import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#fff',
      textSecondary: '#999',
      cardHover: '#333',
      error: '#f00',
    },
  }),
}));

import { FeedbackStoreStatus } from './FeedbackStoreStatus';

describe('FeedbackStoreStatus', () => {
  it('shows a loading message without a retry while the store loads', () => {
    render(<FeedbackStoreStatus isLoading onRetry={vi.fn()} />);

    expect(screen.getByText('Loading your store…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains the failure and calls onRetry when Retry is pressed', () => {
    const onRetry = vi.fn();
    render(<FeedbackStoreStatus isLoading={false} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'this report can’t be sent yet'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Try loading your store again' })
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
