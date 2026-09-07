import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OfflineNotice } from './OfflineNotice';
vi.mock('./use-confirmed-offline', () => ({ useConfirmedOffline: () => true }));
describe('OfflineNotice', () => {
  it('allows the shopper to dismiss a notice instead of blocking checkout actions', () => {
    render(<OfflineNotice />);
    expect(screen.getByText('No Internet Connection')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss connection notice' }));
    expect(screen.queryByText('No Internet Connection')).not.toBeInTheDocument();
  });
});
