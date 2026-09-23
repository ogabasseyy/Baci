import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingPickupActions } from './booking-pickup-actions';

const mocks = vi.hoisted(() => ({
  requestPickup: vi.fn(),
}));

vi.mock('./bookings-api', () => ({
  requestPickup: mocks.requestPickup,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('BookingPickupActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a tracking link when a shipment already exists', () => {
    render(
      <BookingPickupActions
        bookingId="r-1"
        onChanged={vi.fn()}
        trackingNumber="TRK-1"
      />
    );
    expect(screen.getByRole('link', { name: /Track TRK-1/i })).toHaveAttribute(
      'href',
      '/track/TRK-1'
    );
  });

  it('books a courier pickup on request', async () => {
    const onChanged = vi.fn();
    mocks.requestPickup.mockResolvedValueOnce({
      result: { ok: true, trackingNumber: 'TRK-9' },
    });
    render(
      <BookingPickupActions
        bookingId="r-1"
        onChanged={onChanged}
        trackingNumber={null}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Request courier pickup/i })
    );

    await waitFor(() =>
      expect(mocks.requestPickup).toHaveBeenCalledWith('r-1', 'auto')
    );
    expect(
      await screen.findByText(/Courier pickup booked/i)
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers the manual fallback when courier booking is unavailable', async () => {
    mocks.requestPickup.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: 'gigl_unavailable',
        message: 'No coverage',
        canRetryManually: true,
      },
    });
    render(
      <BookingPickupActions
        bookingId="r-1"
        onChanged={vi.fn()}
        trackingNumber={null}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Request courier pickup/i })
    );

    expect(await screen.findByText('No coverage')).toBeInTheDocument();
    const manual = await screen.findByRole('button', {
      name: /Mark pickup arranged manually/i,
    });

    mocks.requestPickup.mockResolvedValueOnce({ ok: true, manual: true });
    fireEvent.click(manual);

    await waitFor(() =>
      expect(mocks.requestPickup).toHaveBeenLastCalledWith('r-1', 'manual')
    );
  });
});
