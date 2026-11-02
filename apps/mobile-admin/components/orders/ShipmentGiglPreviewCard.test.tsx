import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COLORS, type ThemeColors } from '@/constants/theme';
import { ShipmentGiglPreviewCard } from './ShipmentGiglPreviewCard';

const colors: ThemeColors = COLORS;

describe('ShipmentGiglPreviewCard', () => {
  it('shows the price and wallet detail lines with nothing to select', () => {
    render(
      <ShipmentGiglPreviewCard
        colors={colors}
        description="Express · 2 days"
        details={[
          { text: 'Wallet balance: ₦1,000' },
          { text: 'Top up ₦10,000 to book', tone: 'warning' },
        ]}
        price="₦11,000"
      />
    );
    expect(screen.getByText('GIG delivery')).toBeInTheDocument();
    expect(screen.getByText('₦11,000')).toBeInTheDocument();
    expect(screen.getByText('Wallet balance: ₦1,000')).toBeInTheDocument();
    expect(screen.getByText('Top up ₦10,000 to book')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('omits the price and details when there are none', () => {
    render(
      <ShipmentGiglPreviewCard
        colors={colors}
        description="Get a GIG delivery price for this order."
        details={[]}
      />
    );
    expect(screen.queryByText(/₦/)).toBeNull();
  });
});
