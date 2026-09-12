import './negotiations-test-setup';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Alert } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import NegotiationsScreen from './negotiations';
import { mocks } from './negotiations-test-setup';

describe('NegotiationsScreen', () => {
  it('resolves negotiation status through the server endpoint', async () => {
    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('Accept Offer'));

    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith('/api/negotiations/resolve', {
        method: 'POST',
        body: JSON.stringify({
          negotiationId: 'negotiation-1',
          status: 'accepted',
        }),
      });
    });
    expect(mocks.queryCalls.some(({ method }) => method === 'update')).toBe(
      false
    );
  });

  it('sends rejected decisions to the same server endpoint', async () => {
    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('Reject'));

    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith('/api/negotiations/resolve', {
        method: 'POST',
        body: JSON.stringify({
          negotiationId: 'negotiation-1',
          status: 'rejected',
        }),
      });
    });
  });

  it('surfaces resolve failures instead of treating notification failure as success', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(
      new Error('Failed to notify the customer. Please try again.')
    );

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('Accept Offer'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Failed to notify the customer. Please try again.'
      );
    });
    expect(mocks.notificationAsync).toHaveBeenCalledWith('error');
    expect(mocks.notificationAsync).not.toHaveBeenCalledWith('success');
  });

  it('subscribes to all merchant negotiation row changes', async () => {
    render(<NegotiationsScreen />);

    await waitFor(() => {
      expect(mocks.channelOn).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({
          event: '*',
          filter: 'merchant_id=eq.merchant-1',
          schema: 'public',
          table: 'negotiation_requests',
        }),
        expect.any(Function)
      );
    });
  });

  it('does not fetch or render negotiations when the merchant context is missing', async () => {
    mocks.merchant = null;

    render(<NegotiationsScreen />);

    await waitFor(() => {
      expect(screen.queryByText('Accept Offer')).toBeNull();
    });
    expect(mocks.queryCalls.some(({ method }) => method === 'select')).toBe(
      false
    );
    expect(mocks.queryCalls.some(({ method }) => method === 'update')).toBe(
      false
    );
  });

  it('shows an error when the resolve API fails', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('permission denied'));

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('Accept Offer'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'permission denied');
    });
    expect(mocks.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('shows a stale-state error and refreshes when the request was already handled', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(
      new Error('This request was already handled. Pull to refresh.')
    );

    render(<NegotiationsScreen />);

    const acceptButton = await screen.findByText('Accept Offer');
    const selectCountBeforeAction = mocks.queryCalls.filter(
      ({ method }) => method === 'select'
    ).length;

    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'This request was already handled. Pull to refresh.'
      );
    });
    // Must NOT report success or notify the customer for a no-op update.
    expect(mocks.notificationAsync).toHaveBeenCalledWith('error');
    expect(mocks.notificationAsync).not.toHaveBeenCalledWith('success');
    await waitFor(() => {
      expect(
        mocks.queryCalls.filter(({ method }) => method === 'select').length
      ).toBeGreaterThan(selectCountBeforeAction);
    });
  });
});
