import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { OrderRefundStatusLine } from './order-refund-status-line';

const summary = (over: Partial<RefundSummary>) =>
  ({
    cancellationRefundMode: 'manual',
    canManageRefunds: true,
    canRecordManual: true,
    remaining: 5000,
    status: 'not_started',
    ...over,
  }) as RefundSummary;

describe('OrderRefundStatusLine', () => {
  it('says the refund is pending when a cancel-only order is waiting for a manual record', () => {
    render(<OrderRefundStatusLine summary={summary({})} />);
    expect(screen.getByRole('status')).toHaveTextContent('Refund pending');
    expect(
      screen.getByText(/no automatic refund was queued/i)
    ).toBeInTheDocument();
  });

  it('keeps the neutral label when nothing is outstanding', () => {
    render(<OrderRefundStatusLine summary={summary({ remaining: 0 })} />);
    expect(screen.getByRole('status')).not.toHaveTextContent('Refund pending');
    expect(
      screen.queryByText(/no automatic refund was queued/i)
    ).not.toBeInTheDocument();
  });

  it('explains the pending refund to viewers who cannot record it', () => {
    render(
      <OrderRefundStatusLine summary={summary({ canRecordManual: false })} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Refund pending');
    expect(
      screen.getByText(/refund permission needs to refund the customer/i)
    ).toBeInTheDocument();
  });

  it.each([
    ['automatic', 'automatic'],
    ['unknown', null],
    ['missing', undefined],
  ])('keeps neutral copy for a not-started order with %s cancel mode', (_label, mode) => {
    render(
      <OrderRefundStatusLine
        summary={summary({
          cancellationRefundMode:
            mode as RefundSummary['cancellationRefundMode'],
        })}
      />
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('Refund pending');
    expect(
      screen.queryByText(/no automatic refund was queued/i)
    ).not.toBeInTheDocument();
  });

  it('does not tell a viewer without refund management to record the refund', () => {
    render(
      <OrderRefundStatusLine
        summary={summary({ canManageRefunds: false, canRecordManual: true })}
      />
    );
    expect(
      screen.getByText(/refund permission needs to refund the customer/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/record it with Record manual refund/i)
    ).toBeNull();
  });

  it('says refund status is unavailable when the cancel mode could not be read', () => {
    render(
      <OrderRefundStatusLine
        summary={summary({ cancellationRefundMode: 'unknown' as never })}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      /refund status unavailable/i
    );
    expect(screen.queryByText(/no automatic refund was queued/i)).toBeNull();
  });
});
