import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RepairStatusResult } from '@/lib/repairs/status-lookup';
import { RepairStatusTimeline } from './repair-status-timeline';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const baseResult: RepairStatusResult = {
  ticketNumber: 1042,
  status: 'in_progress',
  deviceLabel: 'Smartphone iPhone 15',
  repairTypeLabel: 'Screen Replacement',
  serviceType: 'pickup',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-05T00:00:00.000Z',
  trackingNumber: null,
  pickupPaymentStatus: 'paid',
  pickupFee: 8250,
  pickupCurrency: 'NGN',
};

describe('RepairStatusTimeline', () => {
  it('renders the ticket, device and current status', () => {
    render(<RepairStatusTimeline result={baseResult} />);
    expect(screen.getByText('Ticket #1042')).toBeInTheDocument();
    expect(screen.getByText('Smartphone iPhone 15')).toBeInTheDocument();
    // Appears in both the status badge and the timeline step.
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
  });

  it('renders a terminal banner for cancelled repairs instead of the stepper', () => {
    render(
      <RepairStatusTimeline result={{ ...baseResult, status: 'cancelled' }} />
    );
    expect(
      screen.getByText('This repair request has been cancelled.')
    ).toBeInTheDocument();
  });

  it('shows a tracking link when a shipment tracking number is present', () => {
    render(
      <RepairStatusTimeline
        result={{ ...baseResult, trackingNumber: 'TRK-1' }}
        trackHref="/track/TRK-1"
      />
    );
    const link = screen.getByRole('link', { name: /Track courier pickup/i });
    expect(link).toHaveAttribute('href', '/track/TRK-1');
  });

  it('shows that paid pickup is being arranged before a waybill exists', () => {
    render(<RepairStatusTimeline result={baseResult} />);

    expect(
      screen.getByText('Payment confirmed. Arranging your GIGL pickup.')
    ).toBeInTheDocument();
    expect(screen.getByText('Pickup fee: ₦8,250')).toBeInTheDocument();
  });

  it('shows that pickup payment is required before payment confirmation', () => {
    render(
      <RepairStatusTimeline
        result={{
          ...baseResult,
          pickupCurrency: null,
          pickupFee: null,
          pickupPaymentStatus: 'awaiting_payment',
        }}
      />
    );

    expect(
      screen.getByText('Pickup payment is still required.')
    ).toBeInTheDocument();
  });

  it('does not claim payment is required for legacy null payment columns', () => {
    render(
      <RepairStatusTimeline
        result={{
          ...baseResult,
          pickupCurrency: null,
          pickupFee: null,
          pickupPaymentStatus: null,
        }}
      />
    );

    expect(
      screen.getByText(
        'Courier pickup will be arranged once your request is confirmed.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Pickup payment is still required.')
    ).not.toBeInTheDocument();
  });

  it('treats legacy tracked pickups as booked when payment status is null', () => {
    render(
      <RepairStatusTimeline
        result={{
          ...baseResult,
          pickupCurrency: null,
          pickupFee: null,
          pickupPaymentStatus: null,
          trackingNumber: 'TRK-LEGACY',
        }}
        trackHref="/track/TRK-LEGACY"
      />
    );

    expect(
      screen.getByText('Your GIGL pickup is booked. Follow its progress below.')
    ).toBeInTheDocument();
  });

  it('omits the tracking link when there is no tracking number', () => {
    render(<RepairStatusTimeline result={baseResult} trackHref="/track/x" />);
    expect(
      screen.queryByRole('link', { name: /Track courier pickup/i })
    ).not.toBeInTheDocument();
  });

  it('shows a booked pickup with tracking', () => {
    render(
      <RepairStatusTimeline
        result={{
          ...baseResult,
          pickupPaymentStatus: 'booked',
          trackingNumber: '1349000000',
        }}
        trackHref="/track/1349000000"
      />
    );

    expect(
      screen.getByText('Your GIGL pickup is booked. Follow its progress below.')
    ).toBeInTheDocument();
  });

  it('explains that tracking may follow a booked pickup', () => {
    render(
      <RepairStatusTimeline
        result={{ ...baseResult, pickupPaymentStatus: 'booked' }}
      />
    );

    expect(
      screen.getByText(
        'Your GIGL pickup is booked. Tracking will appear shortly.'
      )
    ).toBeInTheDocument();
  });

  it('shows the support-review state without claiming the pickup is booked', () => {
    render(
      <RepairStatusTimeline
        result={{ ...baseResult, pickupPaymentStatus: 'review' }}
      />
    );

    expect(
      screen.getByText('Payment confirmed. Your pickup needs support review.')
    ).toBeInTheDocument();
  });

  it('shows merchant manual fulfillment without claiming payment was confirmed', () => {
    render(
      <RepairStatusTimeline
        result={{ ...baseResult, pickupPaymentStatus: 'manual_fulfilled' }}
      />
    );

    expect(screen.getByText('Manual courier arranged.')).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/i)).not.toBeInTheDocument();
  });
});
