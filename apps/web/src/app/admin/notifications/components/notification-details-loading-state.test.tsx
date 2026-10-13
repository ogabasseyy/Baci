import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationDetailsLoadingState } from './notification-details-loading-state';

describe('NotificationDetailsLoadingState', () => {
  it('announces that notification details are loading', () => {
    render(<NotificationDetailsLoadingState />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(
      screen.getByText('Loading notification details')
    ).toBeInTheDocument();
  });
});
