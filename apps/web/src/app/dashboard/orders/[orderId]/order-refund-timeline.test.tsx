import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderRefundTimeline } from './order-refund-timeline';

describe('OrderRefundTimeline', () => {
  it('renders nothing without events or history', () => {
    const { container } = render(
      <OrderRefundTimeline
        currency="NGN"
        events={[]}
        eventsTruncated={false}
        history={[]}
        historyTruncated={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('renders activity errors with their previous line', () => {
    render(
      <OrderRefundTimeline
        currency="NGN"
        eventsTruncated={false}
        events={[
          {
            action: 'manual_recorded',
            date: '2026-09-28T12:00:00Z',
            details: {
              error: 'The refund ran into a problem. Support has the details.',
              previousError: 'Refund is processing or requires review',
            },
            id: 'event-1',
          },
        ]}
        history={[]}
        historyTruncated={false}
      />
    );
    expect(
      screen.getByText(
        'The refund ran into a problem. Support has the details.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Previously: Refund is processing or requires review')
    ).toBeInTheDocument();
  });
  it('falls back on unknown labels and malformed timestamps', () => {
    render(
      <OrderRefundTimeline
        currency="NGN"
        eventsTruncated={false}
        events={[
          {
            action: 'something_new',
            date: 'not-a-date',
            details: {},
            id: 'event-9',
          },
        ]}
        historyTruncated={false}
        history={[
          {
            amount: 100,
            date: 'also-not-a-date',
            id: 'refund-9',
            method: 'mystery_rail',
            note: null,
            reference: 'odd-1',
            status: 'weird_state',
          },
        ]}
      />
    );
    // The unknown action falls back to the generic label next to
    // the details summary.
    expect(screen.getAllByText(/Refund activity/)).toHaveLength(2);
    expect(screen.getAllByText(/Date unavailable/)).toHaveLength(2);
    expect(screen.getByText(/weird_state/)).toBeInTheDocument();
    expect(screen.getByText(/mystery_rail/)).toBeInTheDocument();
    expect(screen.getByText('odd-1')).toBeInTheDocument();
  });
  it('renders a null-details legacy event without crashing', () => {
    // The mask passes null details through for legacy rows; the
    // timeline must degrade to no error line, not throw.
    render(
      <OrderRefundTimeline
        currency="NGN"
        eventsTruncated={false}
        events={[
          {
            action: 'manual_recorded',
            date: '2026-09-28T12:00:00Z',
            details: null as unknown as Record<string, never>,
            id: 'event-legacy',
          },
        ]}
        history={[]}
        historyTruncated={false}
      />
    );
    expect(screen.getByText(/Refund activity/)).toBeInTheDocument();
  });
  it('formats history money with the order currency', () => {
    render(
      <OrderRefundTimeline
        currency="NGN"
        eventsTruncated={false}
        events={[]}
        historyTruncated={false}
        history={[
          {
            amount: 27574.83,
            date: '2026-09-28T12:00:00Z',
            id: 'refund-1',
            method: 'bank_transfer',
            note: 'Counter payment confirmed',
            reference: 'bank-1',
            status: 'completed',
          },
          {
            amount: 10,
            date: '2026-09-28T12:00:00Z',
            id: 'refund-2',
            method: 'bank_transfer',
            note: null,
            reference: 'bank-2',
            status: 'completed',
          },
        ]}
      />
    );
    expect(screen.getByText(/₦27,574.83/)).toBeInTheDocument();
    expect(screen.getByText('bank-1')).toBeInTheDocument();
    // Recorded notes surface in the timeline; missing notes
    // render nothing (no empty annotation row).
    expect(screen.getByText('Counter payment confirmed')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });
  it('shows truncation notes when the server caps the lists', () => {
    render(
      <OrderRefundTimeline
        currency="NGN"
        events={[
          {
            action: 'manual_recorded',
            date: '2026-09-28T12:00:00Z',
            details: {},
            id: 'event-t',
          },
        ]}
        eventsTruncated={true}
        history={[
          {
            amount: 10,
            date: '2026-09-28T12:00:00Z',
            id: 'refund-t',
            method: 'bank_transfer',
            note: null,
            reference: 'bank-t',
            status: 'completed',
          },
        ]}
        historyTruncated={true}
      />
    );
    expect(
      screen.getByText(/older activity is in the audit log/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/older refunds are in the audit log/)
    ).toBeInTheDocument();
  });
});
