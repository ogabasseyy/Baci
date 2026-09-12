import './negotiations-test-setup';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Alert } from 'react-native';
import { describe, expect, it } from 'vitest';
import NegotiationsScreen from './negotiations';
import { mocks } from './negotiations-test-setup';

describe('NegotiationsScreen', () => {
  it('opens the evidence link in the OS handler', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: null,
          customer_phone: null,
          evidence_url: 'https://x.com/i/status/123',
          id: 'negotiation-evidence-1',
          item_info: { name: 'Wireless Headphones' },
          offered_price: 8_500,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('View customer evidence'));
    await waitFor(() => {
      expect(mocks.openURL).toHaveBeenCalledWith('https://x.com/i/status/123');
    });
  });

  it('shows an error when an external evidence URL cannot be opened', async () => {
    mocks.openURL.mockRejectedValueOnce(new Error('blocked'));
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: null,
          customer_phone: null,
          evidence_url: 'https://x.com/i/status/123',
          id: 'negotiation-evidence-unsupported',
          item_info: { name: 'Wireless Headphones' },
          offered_price: 8_500,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('View customer evidence'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Cannot open link',
        'https://x.com/i/status/123'
      );
    });
    expect(mocks.canOpenURL).not.toHaveBeenCalledWith(
      'https://x.com/i/status/123'
    );
    expect(mocks.openURL).toHaveBeenCalledWith('https://x.com/i/status/123');
  });

  it('opens stored evidence paths through a fresh signed URL', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: null,
          customer_phone: null,
          evidence_url: 'merchant-1/1719260000000-proof.png',
          id: 'negotiation-evidence-storage',
          item_info: { name: 'Wireless Headphones' },
          offered_price: 8_500,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('View customer evidence'));
    await waitFor(() => {
      expect(mocks.createSignedUrl).toHaveBeenCalledWith(
        'merchant-1/1719260000000-proof.png',
        3600
      );
      expect(mocks.openURL).toHaveBeenCalledWith(
        'https://signed.example/evidence.png'
      );
    });
  });

  it('shows non-URL evidence as text instead of opening a link', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: null,
          customer_phone: null,
          evidence_url: 'uploaded_evidence_placeholder',
          id: 'negotiation-evidence-2',
          item_info: { name: 'Wireless Headphones' },
          offered_price: 8_500,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('View customer evidence'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Customer evidence',
      'uploaded_evidence_placeholder'
    );
    expect(mocks.openURL).not.toHaveBeenCalled();
  });

  it('shows a scheme-less competitor image link as text instead of signing it', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: null,
          customer_phone: null,
          evidence_url: 'www.example.com/product-image.jpg',
          id: 'negotiation-evidence-schemeless',
          item_info: { name: 'Wireless Headphones' },
          offered_price: 8_500,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    fireEvent.click(await screen.findByText('View customer evidence'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Customer evidence',
      'www.example.com/product-image.jpg'
    );
    // It is NOT a storage object, so we never attempt to sign it.
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
});
