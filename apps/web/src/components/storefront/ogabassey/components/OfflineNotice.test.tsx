import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OfflineNotice } from './OfflineNotice';

const mockUseConfirmedOffline = vi.fn(() => true);

vi.mock('./use-confirmed-offline', () => ({
  useConfirmedOffline: () => mockUseConfirmedOffline(),
}));

describe('OfflineNotice', () => {
  it('allows the shopper to dismiss a notice instead of blocking checkout actions', () => {
    mockUseConfirmedOffline.mockReturnValue(true);
    render(<OfflineNotice />);
    expect(screen.getByText('No Internet Connection')).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss connection notice' })
    );
    expect(screen.queryByText('No Internet Connection')).not.toBeInTheDocument();
  });

  describe('bugfix: dismissal suppressed later outages', () => {
    it('shows the notice again after connectivity returns then drops', () => {
      mockUseConfirmedOffline.mockReturnValue(true);
      const { rerender } = render(<OfflineNotice />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Dismiss connection notice' })
      );
      expect(
        screen.queryByText('No Internet Connection')
      ).not.toBeInTheDocument();

      mockUseConfirmedOffline.mockReturnValue(false);
      rerender(<OfflineNotice />);

      mockUseConfirmedOffline.mockReturnValue(true);
      rerender(<OfflineNotice />);
      expect(screen.getByText('No Internet Connection')).toBeVisible();
    });
  });
});
