import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';

describe('RepairBookingLcpIntro', () => {
  it('paints the booking heading and a visible extractive answer', () => {
    render(<RepairBookingLcpIntro />);

    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/describe the model, visible damage and fault symptoms/i)
    ).not.toHaveClass('sr-only');
    expect(
      document.querySelector('[data-cwv-lcp-copy="repair"]')
    ).toHaveTextContent('Book a Repair Service');
    expect(
      document.querySelector('[data-cwv-lcp-support]')
    ).toBeInTheDocument();
    expect(document.querySelector('[data-cwv-lcp-fold]')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Before you book a repair' })
    ).not.toBeInTheDocument();
  });
});
