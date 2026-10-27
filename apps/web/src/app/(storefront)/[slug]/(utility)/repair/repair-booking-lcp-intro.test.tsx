import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';

describe('RepairBookingLcpIntro', () => {
  it('paints the booking heading and concise visible supporting copy', () => {
    render(<RepairBookingLcpIntro />);

    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/our team will help with the next step/i)
    ).not.toHaveClass('sr-only');
    expect(
      document.querySelector('[data-cwv-lcp-copy="repair"]')
    ).toHaveTextContent('Book a Repair Service');
    expect(
      document.querySelector('[data-cwv-lcp-support]')
    ).toBeInTheDocument();
    const lcpFold = document.querySelector('[data-cwv-lcp-fold]');
    expect(lcpFold).toHaveAttribute('data-repair-booking-lcp-fold');
    expect(lcpFold).not.toContainElement(
      screen.getByText(/our team will help with the next step/i)
    );
    expect(
      screen.queryByRole('heading', { name: 'Before you book a repair' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Ogabassey repair support')
    ).not.toBeInTheDocument();
  });
});
