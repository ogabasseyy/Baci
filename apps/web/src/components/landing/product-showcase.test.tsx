import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductShowcase } from '@/components/landing/product-showcase';

describe('ProductShowcase', () => {
  it('renders Price Negotiation preview by default and updates offer state', () => {
    render(<ProductShowcase />);

    expect(
      screen.getByText(/Within your 2% margin floor/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Offer ₦110,000/i }));
    expect(
      screen.getByText(/margin-safe counter-offer of ₦117,600/i)
    ).toBeInTheDocument();
  });

  it('switches to Discounts & Loyalty tab and recalculates total', () => {
    render(<ProductShowcase />);

    fireEvent.click(screen.getByRole('tab', { name: /Discounts & Loyalty/i }));
    expect(screen.getByText('₦108,000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /VIP5000/i }));
    expect(screen.getByText('₦115,000')).toBeInTheDocument();
  });

  it('switches to Mobile Admin tab and toggles offer approval', () => {
    render(<ProductShowcase />);

    fireEvent.click(screen.getByRole('tab', { name: /Mobile Admin/i }));
    const approveBtn = screen.getByRole('button', { name: /Accept Offer/i });
    fireEvent.click(approveBtn);

    expect(
      screen.getByRole('button', { name: /Approved/i })
    ).toBeInTheDocument();
  });
});
