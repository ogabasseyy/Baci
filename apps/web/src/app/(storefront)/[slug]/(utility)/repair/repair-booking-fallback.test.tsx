import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBookingFallback } from './repair-booking-fallback';

describe('RepairBookingFallback', () => {
  it('paints the repair LCP copy in the visible page shell', () => {
    render(<RepairBookingFallback />);

    const status = screen.getByRole('status', {
      name: 'Loading repair booking',
    });

    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Before you book a repair' })
    ).not.toBeInTheDocument();
  });

  it('omits the intro when the parent already committed it', () => {
    render(<RepairBookingFallback hideIntro />);

    expect(
      screen.queryByRole('heading', { name: 'Book a Repair Service' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading repair booking' })
    ).toBeInTheDocument();
  });
});
