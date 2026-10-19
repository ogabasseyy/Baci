import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperationsSummary } from './operations-summary';

describe('OperationsSummary', () => {
  it('renders each operational incident category instead of combining money and delivery failures', () => {
    render(
      <OperationsSummary
        canReadFinancials
        summary={{
          notifications: 6,
          paymentSideEffects: 2,
          payouts: 3,
          reconciliationReview: 1,
          settlements: 4,
          shipping: 5,
          workers: 7,
        }}
      />
    );

    expect(screen.getByText('Reconciliation review')).toBeInTheDocument();
    expect(screen.getByText('Notification failures')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('hides payout and settlement incident counts from non-financial readers', () => {
    render(
      <OperationsSummary
        canReadFinancials={false}
        summary={{
          notifications: 0,
          paymentSideEffects: 0,
          payouts: 3,
          reconciliationReview: 0,
          settlements: 4,
          shipping: 0,
          workers: 0,
        }}
      />
    );

    expect(screen.queryByText('Settlement issues')).not.toBeInTheDocument();
    expect(screen.queryByText('Payout issues')).not.toBeInTheDocument();
  });
});
