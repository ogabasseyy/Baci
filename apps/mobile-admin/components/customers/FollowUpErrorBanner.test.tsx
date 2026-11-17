import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpErrorBanner } from './FollowUpErrorBanner';

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', null),
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      backgroundLight: '#f2f2f7',
      primary: '#0a84ff',
      textSecondary: '#aeaeb2',
      warning: '#ff9500',
    },
  }),
}));

describe('FollowUpErrorBanner', () => {
  it('warns when follow-ups may be incomplete or stale', () => {
    render(<FollowUpErrorBanner isRetrying={false} onRetry={vi.fn()} />);

    expect(
      screen.getByText(
        "Some follow-ups couldn't be loaded or may be out of date."
      )
    ).toBeTruthy();
  });

  it('calls onRetry when retry is pressed', () => {
    const onRetry = vi.fn();
    render(<FollowUpErrorBanner isRetrying={false} onRetry={onRetry} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading follow-ups' })
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables retry while a retry is already in flight', () => {
    const onRetry = vi.fn();
    render(<FollowUpErrorBanner isRetrying={true} onRetry={onRetry} />);

    const retry = screen.getByRole('button', {
      name: 'Retry loading follow-ups',
    });
    expect(retry).toBeDisabled();
    expect(screen.getByText('Retrying…')).toBeTruthy();

    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
