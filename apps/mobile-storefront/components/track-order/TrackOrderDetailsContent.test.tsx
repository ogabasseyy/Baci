import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { TrackOrderDetailsContent } from './TrackOrderDetailsContent';
import type { TrackOrderData } from './TrackOrderScreen.types';

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('@/components/track-order/TrackOrderTimelineCard', () => ({
  TrackOrderTimelineCard: () => null,
}));

jest.mock('./TrackOrderContactCard', () => ({
  TrackOrderContactCard: () => null,
}));

jest.mock('./TrackOrderItemsCard', () => ({
  TrackOrderItemsCard: ({ items }: { items: TrackOrderData['items'] }) => {
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return <Text>{items[0]?.product_name}</Text>;
  },
}));

const trackOrderData: TrackOrderData = {
  order: {
    id: 'order-1',
    order_number: 'ORD-100',
    status: 'shipped',
    payment_status: 'paid',
    created_at: '2026-08-01T12:00:00.000Z',
    subtotal: 150000,
    shipping_cost: 0,
    discount_amount: 0,
    total: 150000,
    currency: 'NGN',
  },
  customer: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+2348000000000',
  },
  shipping_address: {
    address: '1 Code Street',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
  },
  items: [
    {
      id: 'item-1',
      product_id: 'product-1',
      product_name: 'Test Phone',
      quantity: 1,
      unit_price: 150000,
      total_price: 150000,
      product_image: 'https://example.com/phone.gif',
    },
  ],
  timeline: [],
  shipping_tracking: null,
  estimated_delivery: null,
  merchant: {
    name: 'Ogabassey',
    logo: null,
    support_email: null,
    support_phone: null,
  },
};

describe('TrackOrderDetailsContent', () => {
  it('renders order items through the extracted items card', () => {
    render(
      <TrackOrderDetailsContent colors={Colors.light} data={trackOrderData} />
    );

    expect(screen.getByText('Test Phone')).toBeTruthy();
  });
});
