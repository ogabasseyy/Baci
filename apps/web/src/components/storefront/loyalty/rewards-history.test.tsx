import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PointsTransaction } from '@/lib/loyalty-data-client';
import { RewardsHistory } from './rewards-history';

const earn: PointsTransaction = {
  id: 'tx-1',
  points: 250,
  type: 'earn',
  description: 'Order #1042',
  created_at: '2026-10-01T10:00:00.000Z',
  redemption_code: null,
};

const spend: PointsTransaction = {
  id: 'tx-2',
  points: -500,
  type: 'redemption',
  description: 'Free mug',
  created_at: '2026-10-05T10:00:00.000Z',
  redemption_code: 'RDM-ABC123',
};

describe('RewardsHistory', () => {
  it('renders the empty state without transactions', () => {
    render(<RewardsHistory transactions={[]} />);

    expect(screen.getByText('Points History')).toBeTruthy();
    expect(screen.getByText('No transactions yet')).toBeTruthy();
  });

  it('renders earn and redemption rows with signed points and codes', () => {
    render(<RewardsHistory transactions={[earn, spend]} />);

    expect(screen.getByText('Order #1042')).toBeTruthy();
    expect(screen.getByText('+250 pts')).toBeTruthy();
    expect(screen.getByText('Free mug')).toBeTruthy();
    expect(screen.getByText('-500 pts')).toBeTruthy();
    expect(screen.getByText('Code: RDM-ABC123')).toBeTruthy();
  });

  it('uses storefront theme tokens instead of fixed status colors', () => {
    render(<RewardsHistory transactions={[earn, spend]} />);

    // Earn = merchant brand token; spend = theme destructive token.
    // Fixed green/red utilities would bypass merchant palettes.
    expect(screen.getByText('+250 pts').className).toContain(
      'text-store-primary'
    );
    expect(screen.getByText('-500 pts').className).toContain(
      'text-destructive'
    );
  });
});
