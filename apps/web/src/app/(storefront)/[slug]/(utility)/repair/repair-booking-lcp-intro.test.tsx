import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';

describe('RepairBookingLcpIntro', () => {
  it('paints the booking heading and before-you-book LCP paragraph', () => {
    render(<RepairBookingLcpIntro />);

    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Before you book a repair' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/describe the device model, visible damage/i)
    ).toBeInTheDocument();
  });
});
