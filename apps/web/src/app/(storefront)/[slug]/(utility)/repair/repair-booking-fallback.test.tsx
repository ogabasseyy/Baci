import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBookingFallback } from './repair-booking-fallback';

describe('RepairBookingFallback', () => {
  it('paints the repair LCP copy in the visible page shell', () => {
    render(<RepairBookingFallback />);

    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Before you book a repair' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/For phones, laptops, tablets, consoles and accessories/)
    ).toBeInTheDocument();
  });
});
