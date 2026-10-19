import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationWithStats } from '@/types/notifications';
import { NotificationDeliveryStatus } from './notification-delivery-status';

const notification = {
  delivery_state: 'pending',
  scheduled_for: null,
} as NotificationWithStats;

describe('NotificationDeliveryStatus', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps terminal worker failures visible even when a schedule exists', () => {
    render(
      <NotificationDeliveryStatus
        notification={{
          ...notification,
          delivery_state: 'failed',
          scheduled_for: '2026-12-01T10:00:00.000Z',
        }}
      />
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
  });

  it('distinguishes future scheduled work from due queued work', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
    const { rerender } = render(
      <NotificationDeliveryStatus
        notification={{
          ...notification,
          scheduled_for: '2026-08-05T13:00:00.000Z',
        }}
      />
    );

    expect(screen.getByText('Scheduled')).toBeInTheDocument();

    rerender(
      <NotificationDeliveryStatus
        notification={{
          ...notification,
          scheduled_for: '2026-08-05T11:59:59.000Z',
        }}
      />
    );

    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
});
