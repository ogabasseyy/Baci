import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationWithStats } from '@/types/notifications';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

import { NotificationListTable } from './notification-list-table';

const notification: NotificationWithStats = {
  action_label: null,
  action_url: null,
  channels: ['in_app'],
  created_at: '2026-08-05T10:00:00.000Z',
  created_by: 'admin-1',
  delivery_attempts: 0,
  delivery_last_error: null,
  delivery_state: 'pending',
  expires_at: null,
  id: 'notification-1',
  is_system: false,
  message: 'Dashboard maintenance',
  notification_type: 'warning',
  priority: 'high',
  scheduled_for: '2026-12-01T10:00:00.000Z',
  sent_at: null,
  stats: { read_rate: 0, total_dismissed: 0, total_read: 0, total_sent: 0 },
  target_merchant_ids: [],
  target_segment: null,
  target_type: 'all',
  template_id: null,
  title: 'Maintenance',
};

describe('NotificationListTable', () => {
  it('shows cancellation only for mutable pending work and uses a dash before delivery', () => {
    render(
      <NotificationListTable
        notifications={[
          notification,
          {
            ...notification,
            delivery_state: 'sent',
            id: 'notification-2',
            title: 'Sent notice',
          },
        ]}
        onDelete={vi.fn()}
        onView={vi.fn()}
      />
    );

    expect(screen.getAllByText('View Details')).toHaveLength(2);
    expect(screen.getAllByText('Cancel Pending')).toHaveLength(1);
    expect(screen.getAllByText('-')).toHaveLength(2);
    expect(screen.getAllByText('All Merchants')).toHaveLength(2);
  });
});
