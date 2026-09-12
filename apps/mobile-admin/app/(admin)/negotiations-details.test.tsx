import './negotiations-test-setup';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NegotiationsScreen from './negotiations';
import { mocks, negotiationRows } from './negotiations-test-setup';

describe('NegotiationsScreen', () => {
  it('reveals the itemized cart snapshot for a bulk offer when expanded', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: null,
          evidence_url: null,
          id: 'negotiation-total-1',
          item_info: { name: '3 items: iPhone 15 Pro, Galaxy S24' },
          cart_snapshot: [
            {
              product_id: 'p1',
              name: 'iPhone 15 Pro',
              price: 1_200_000,
              quantity: 1,
              condition: 'new',
            },
            {
              product_id: 'p2',
              name: 'Galaxy S24',
              price: 900_000,
              quantity: 2,
            },
          ],
          offered_price: 420_000,
          status: 'pending',
          type: 'total',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    // Collapsed by default: line items are hidden behind the toggle.
    const toggle = await screen.findByText('View 2 items');
    expect(screen.queryByText('iPhone 15 Pro')).toBeNull();

    fireEvent.click(toggle);

    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('Galaxy S24')).toBeInTheDocument();
    // Quantity-aware line total: 900,000 × 2 (currency symbol varies by ICU).
    expect(screen.getByText(/1,800,000/)).toBeInTheDocument();
    expect(screen.getByText('Hide items')).toBeInTheDocument();
  });

  it('shows selected variant details for a single-item offer', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-07-01T00:25:00.000Z',
          customer_id: null,
          evidence_url: null,
          id: 'negotiation-variant-1',
          item_info: {
            name: 'iPhone 14 Pro Max',
            current_price: 875_000,
            variant_attributes: {
              storage: '256GB',
              color: 'Deep Purple',
            },
            condition: 'used',
          },
          offered_price: 820_000,
          status: 'pending',
          type: 'single',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    expect(await screen.findByText('iPhone 14 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('256GB')).toBeInTheDocument();
    expect(screen.getByText('Color')).toBeInTheDocument();
    expect(screen.getByText('Deep Purple')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('used')).toBeInTheDocument();
  });

  it('hides accept and reject actions for completed negotiations', async () => {
    mocks.selectResult = {
      data: [
        {
          ...negotiationRows[0],
          id: 'negotiation-accepted-1',
          status: 'accepted',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText('Accept Offer')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });

  it('does not crash when cart_snapshot is malformed (non-array)', async () => {
    mocks.selectResult = {
      data: [
        {
          created_at: '2026-06-24T23:58:50.000Z',
          customer_id: null,
          customer_phone: null,
          cart_snapshot: 'definitely-not-an-array',
          evidence_url: null,
          id: 'negotiation-bad-snapshot',
          item_info: { name: '3 items' },
          offered_price: 420_000,
          status: 'pending',
          type: 'total',
        },
      ],
      error: null,
    };

    render(<NegotiationsScreen />);

    // Row still renders (no crash); the malformed snapshot is dropped, so no
    // "View … items" toggle appears.
    expect(await screen.findByText('Accept Offer')).toBeInTheDocument();
    expect(screen.queryByText(/View \d+ items?/)).toBeNull();
  });
});
