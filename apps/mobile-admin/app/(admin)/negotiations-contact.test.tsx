import './negotiations-test-setup';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Alert } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import NegotiationsScreen from './negotiations';
import { mocks } from './negotiations-test-setup';

describe('NegotiationsScreen', () => {
  it('opens WhatsApp and a dialer for a customer with a phone number', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: 'customer-9',
          customer_phone: '0803 123 4567',
          evidence_url: null,
          id: 'negotiation-phone-1',
          item_info: { name: 'Wireless Headphones' },
          offered_price: 8_500,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('WhatsApp'));
    await waitFor(() => {
      expect(mocks.openURL).toHaveBeenCalledWith(
        expect.stringContaining('https://wa.me/2348031234567')
      );
    });

    fireEvent.click(screen.getByText('Call'));
    await waitFor(() => {
      expect(mocks.openURL).toHaveBeenCalledWith('tel:+2348031234567');
    });
    expect(mocks.canOpenURL).not.toHaveBeenCalledWith('tel:+2348031234567');
  });

  it('shows a captured email and opens a prefilled email draft', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-08-10T06:12:04.000Z',
          customer_email: ' Buyer@Example.COM ',
          customer_id: null,
          customer_phone: null,
          evidence_url: null,
          id: 'negotiation-email-1',
          item_info: { name: 'Meta Quest 3 512GB' },
          offered_price: 749_985,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    expect(await screen.findByText('buyer@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Email customer' }));

    await waitFor(() => {
      expect(mocks.openURL).toHaveBeenCalledWith(
        'mailto:buyer@example.com?subject=Negotiation%20follow-up%3A%20Meta%20Quest%203%20512GB&body=Hi!%20About%20your%20negotiation%20offer%20on%20Meta%20Quest%203%20512GB%20%E2%80%94'
      );
    });
  });

  it('shows a warning when no delivery channel was captured', async () => {
    render(<NegotiationsScreen />);

    await screen.findByText('Accept Offer');
    expect(screen.queryByText('WhatsApp')).toBeNull();
    expect(screen.queryByText('Call')).toBeNull();
    expect(
      screen.getByText(
        'No delivery channel captured. The customer will not be notified when this request is resolved.'
      )
    ).toBeInTheDocument();
  });

  it('confirms when a decision email was accepted for delivery', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce({
      channel: 'email',
      notified: true,
      status: 'accepted',
    });

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('Accept Offer'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Customer notified',
        'The decision email was accepted for delivery.'
      );
    });
  });

  it('confirms when a decision push notification was sent', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce({
      notified: true,
      status: 'accepted',
    });

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('Accept Offer'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Customer notified',
        'The decision notification was sent.'
      );
    });
  });

  it('warns when a decision succeeds without a delivery channel', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce({
      notified: false,
      reason: 'no_customer_email',
      status: 'accepted',
    });

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('Accept Offer'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Status updated',
        'The request was updated, but the customer has no available delivery channel.'
      );
    });
  });

  it('directs merchants to manual follow-up for phone-only requests', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-08-10T06:12:04.000Z',
          customer_email: null,
          customer_id: null,
          customer_phone: '0803 123 4567',
          evidence_url: null,
          id: 'negotiation-phone-only-1',
          item_info: { name: 'Meta Quest 3 512GB' },
          offered_price: 749_985,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };
    vi.mocked(apiClient).mockResolvedValueOnce({
      manualContactAvailable: true,
      notified: false,
      reason: 'no_customer_email',
      status: 'accepted',
    });

    render(<NegotiationsScreen />);

    expect(
      await screen.findByRole('button', { name: 'Call customer' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Message customer on WhatsApp' })
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByText('Accept Offer'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Status updated',
        'The customer was not notified automatically. Use Call or WhatsApp to follow up.'
      );
    });
  });
});
