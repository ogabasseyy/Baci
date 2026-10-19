import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairBookingPrepSection } from './repair-booking-prep-section';

describe('RepairBookingPrepSection', () => {
  it('keeps booking preparation guidance visible below the LCP intro', () => {
    render(<RepairBookingPrepSection />);

    expect(
      screen.getByRole('heading', { name: 'Before you book a repair' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/back up important data where possible/i)
    ).toBeVisible();
    expect(
      screen
        .getByRole('heading', { name: 'Before you book a repair' })
        .closest('section')
    ).not.toHaveClass('sr-only');
  });
});
