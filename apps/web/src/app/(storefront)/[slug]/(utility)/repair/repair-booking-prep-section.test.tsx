import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBookingPrepSection } from './repair-booking-prep-section';

describe('RepairBookingPrepSection', () => {
  it('keeps booking preparation guidance visible below the LCP intro', () => {
    render(<RepairBookingPrepSection />);

    expect(
      screen.getByRole('heading', { name: 'A quick note before you start' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/final pricing is confirmed after inspection/i)
    ).toBeVisible();
    expect(
      screen
        .getByRole('heading', { name: 'A quick note before you start' })
        .closest('section')
    ).not.toHaveClass('sr-only');
  });
});
