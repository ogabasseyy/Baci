import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontChatOrder } from '@/schemas/storefront-chat-account';
import { ChatOrderTracking } from './chat-order-tracking';

const makeOrder = (
  overrides: Partial<StorefrontChatOrder> = {}
): StorefrontChatOrder => ({
  id: '60000000-0000-4000-8000-000000000001',
  order_number: 'ORD-1001',
  payment_status: 'paid',
  shipping_status: 'shipped',
  payment_method: 'paystack',
  tracking_number: 'GIGL123456789',
  shipping_provider: 'GIGL',
  ...overrides,
});

describe('ChatOrderTracking', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('renders nothing when shipping status is not trackable or tracking number is missing', () => {
    const { container: pending } = render(
      <ChatOrderTracking
        order={makeOrder({ shipping_status: 'processing' })}
        merchantSlug="savings-synthetic"
      />
    );
    expect(pending).toBeEmptyDOMElement();

    const { container: noWaybill } = render(
      <ChatOrderTracking
        order={makeOrder({ tracking_number: null })}
        merchantSlug="savings-synthetic"
      />
    );
    expect(noWaybill).toBeEmptyDOMElement();
  });

  it('loads GIG tracking, displays events, and refreshes on subsequent clicks', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          trackingAvailable: true,
          tracking: {
            provider: 'GIGL',
            carrierName: 'GIG Logistics',
            trackingNumber: 'GIGL123456789',
            status: 'in_transit',
            statusLabel: 'In Transit',
            estimatedDelivery: null,
            actualDelivery: null,
            liveUnavailable: false,
            events: [
              {
                status: 'in_transit',
                timestamp: '2026-11-22T12:00:00Z',
                description: 'Departed Lagos hub',
                location: 'Ikeja',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          trackingAvailable: true,
          tracking: {
            provider: 'GIGL',
            carrierName: 'GIG Logistics',
            trackingNumber: 'GIGL123456789',
            status: 'delivered',
            statusLabel: 'Delivered',
            estimatedDelivery: null,
            actualDelivery: '2026-11-23T06:00:00Z',
            liveUnavailable: false,
            events: [],
          },
        })
      );

    render(
      <ChatOrderTracking
        order={makeOrder()}
        merchantSlug="savings-synthetic"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Track GIG delivery' }));
    expect(
      await screen.findByText('GIG Logistics: In Transit')
    ).toBeInTheDocument();
    expect(screen.getByText('Departed Lagos hub')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh tracking' }));
    expect(
      await screen.findByText('GIG Logistics: Delivered')
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows accessible error alerts on HTTP failures and malformed payloads', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('error', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ bad: 'payload' }));

    render(
      <ChatOrderTracking
        order={makeOrder({ shipping_provider: 'OTHER' })}
        merchantSlug="savings-synthetic"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Track delivery' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not load live tracking right now. Please try again.'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Track delivery' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not read tracking details right now.'
      )
    );
  });
});
