import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairsRecyclingSection } from './repairs-recycling-section';

describe('RepairsRecyclingSection', () => {
  it('renders the recycling heading and disposal callouts', () => {
    render(<RepairsRecyclingSection />);

    expect(
      screen.getByRole('heading', { name: /recycle responsibly/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/contact support before bringing/i)).toBeInTheDocument();
    expect(screen.queryByText('Glass Recycling')).not.toBeInTheDocument();
  });
});
