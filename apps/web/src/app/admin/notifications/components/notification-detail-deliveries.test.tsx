import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationDetailDeliveries } from './notification-detail-deliveries';

const createdAt = new Date(Date.now() - 60_000).toISOString();

describe('NotificationDetailDeliveries', () => {
  it('omits the delivery section until durable recipient records exist', () => {
    const { container } = render(
      <NotificationDetailDeliveries deliveries={[]} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('prioritizes dismissed status above read status and preserves unread rows', () => {
    render(
      <NotificationDetailDeliveries
        deliveries={[
          {
            business_name: 'Dismissed Shop',
            created_at: createdAt,
            dismissed_at: createdAt,
            id: 'delivery-1',
            merchant_id: 'merchant-1',
            read_at: createdAt,
          },
          {
            business_name: 'Unread Shop',
            created_at: createdAt,
            dismissed_at: null,
            id: 'delivery-2',
            merchant_id: 'merchant-2',
            read_at: null,
          },
        ]}
      />
    );

    expect(screen.getAllByText('Dismissed')).toHaveLength(2);
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getAllByText('-')).toHaveLength(2);
  });
});
