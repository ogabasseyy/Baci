import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationWithStats } from '@/types/notifications';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogAction: ({
    children,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import { NotificationList } from './notification-list';

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
  notification_type: 'info',
  priority: 'normal',
  scheduled_for: null,
  sent_at: null,
  stats: { read_rate: 0, total_dismissed: 0, total_read: 0, total_sent: 0 },
  target_merchant_ids: [],
  target_segment: null,
  target_type: 'all',
  template_id: null,
  title: 'Maintenance',
};
const stats = {
  activeBanners: 1,
  avgReadRate: 35,
  deliveryExpired: 2,
  deliveryFailed: 3,
  deliveryPending: 4,
  deliveryProcessing: 5,
  scheduled: 6,
  totalSent: 7,
};

function renderList(
  overrides: Partial<React.ComponentProps<typeof NotificationList>> = {}
) {
  const props = {
    deleteId: null,
    filters: {},
    isLoading: false,
    loadError: null,
    notifications: [notification],
    onDeleteConfirm: vi.fn(),
    onDeleteIdChange: vi.fn(),
    onFiltersChange: vi.fn(),
    onPageChange: vi.fn(),
    onRefresh: vi.fn(),
    onSearchChange: vi.fn(),
    onView: vi.fn(),
    page: 0,
    searchQuery: '',
    stats,
    totalCount: 21,
    ...overrides,
  };
  return { ...render(<NotificationList {...props} />), props };
}

describe('NotificationList', () => {
  it('offers retry for a load failure instead of presenting an empty result', async () => {
    const user = userEvent.setup();
    const { props } = renderList({
      loadError: 'Network unavailable',
      notifications: [],
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    expect(
      screen.queryByText('No notifications found')
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('confirms pending cancellation and paginates from the first page', async () => {
    const user = userEvent.setup();
    const { props } = renderList({ deleteId: 'notification-1' });

    expect(screen.getByText('Showing 1 to 20 of 21')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(
      screen.getByRole('button', { name: 'Cancel Notification' })
    );

    expect(props.onPageChange).toHaveBeenCalledWith(1);
    expect(props.onDeleteConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps Previous available when cancellation leaves an empty later page', async () => {
    const user = userEvent.setup();
    const { props } = renderList({
      notifications: [],
      page: 1,
      totalCount: 20,
    });

    const previous = screen.getByRole('button', { name: 'Previous' });
    expect(previous).toBeEnabled();
    await user.click(previous);

    expect(props.onPageChange).toHaveBeenCalledWith(0);
  });
});
