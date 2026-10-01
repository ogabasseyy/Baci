import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockApiPost = vi.fn();
const mockRouterPush = vi.fn();
const mockToast = vi.fn();

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));

import { CreateNotificationPageClient } from './create-notification-page-client';

describe('CreateNotificationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiPost.mockResolvedValue({
      status: 'queued',
    });
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        disconnect() {
          return undefined;
        }
        observe() {
          return undefined;
        }
        unobserve() {
          return undefined;
        }
      }
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ status: 'queued' }),
        ok: true,
      }) as unknown as typeof fetch
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits notifications through the CSRF-aware admin API client', async () => {
    render(<CreateNotificationPageClient canTargetSpecificMerchants />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Baci will run maintenance tonight.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /queue for delivery/i })
    );

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/admin/notifications', {
        channels: ['in_app'],
        expires_at: undefined,
        message: 'Baci will run maintenance tonight.',
        notification_type: 'info',
        priority: 'normal',
        scheduled_for: undefined,
        target_type: 'all',
        title: 'Maintenance window',
      });
    });

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/notifications',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockRouterPush).toHaveBeenCalledWith('/admin/notifications');
    expect(mockToast).toHaveBeenCalledWith({
      description: 'Notification has been queued for delivery',
      title: 'Notification Queued',
    });
  });

  it('shows an error toast and does not navigate when notification creation fails', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('CSRF token missing'));

    render(<CreateNotificationPageClient canTargetSpecificMerchants />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Baci will run maintenance tonight.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /queue for delivery/i })
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        description: 'CSRF token missing',
        title: 'Error',
        variant: 'destructive',
      });
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('uses the shared schema to reject whitespace-only content', async () => {
    render(<CreateNotificationPageClient canTargetSpecificMerchants />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'A valid message' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /queue for delivery/i })
    );

    expect(mockToast).toHaveBeenCalledWith({
      description: 'Title is required',
      title: 'Error',
      variant: 'destructive',
    });
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('converts scheduled datetime-local input to an explicit UTC timestamp', async () => {
    render(<CreateNotificationPageClient canTargetSpecificMerchants />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Baci will run maintenance tonight.' },
    });
    fireEvent.click(screen.getByLabelText(/schedule for later/i));
    const scheduleDateInput = await screen.findByLabelText(
      /schedule date and time/i
    );
    fireEvent.change(scheduleDateInput, {
      target: { value: '2026-12-01T09:30' },
    });
    fireEvent.submit(
      screen
        .getByRole('button', { name: /schedule notification/i })
        .closest('form') as HTMLFormElement
    );

    await waitFor(() => {
      const payload = mockApiPost.mock.calls[0]?.[1] as {
        scheduled_for?: string;
      };
      expect(payload.scheduled_for).toBe(
        new Date('2026-12-01T09:30').toISOString()
      );
    });
  });

  it('does not submit when an action label is clicked in the preview', () => {
    render(<CreateNotificationPageClient canTargetSpecificMerchants />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Baci will run maintenance tonight.' },
    });
    fireEvent.change(screen.getByLabelText(/action label/i), {
      target: { value: 'Learn more' },
    });
    fireEvent.click(screen.getByText('Learn more'));

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('submits after an optional action URL is cleared', async () => {
    render(<CreateNotificationPageClient canTargetSpecificMerchants />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Baci will run maintenance tonight.' },
    });
    fireEvent.change(screen.getByLabelText(/action url/i), {
      target: { value: 'https://baci.example/maintenance' },
    });
    fireEvent.change(screen.getByLabelText(/action url/i), {
      target: { value: '' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /queue for delivery/i })
    );

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/admin/notifications',
        expect.not.objectContaining({ action_url: '' })
      );
    });
  });

  it('submits a supported relative action URL', async () => {
    render(<CreateNotificationPageClient canTargetSpecificMerchants />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Baci will run maintenance tonight.' },
    });
    fireEvent.change(screen.getByLabelText(/action url/i), {
      target: { value: '/dashboard/orders' },
    });
    expect(screen.getByLabelText(/action url/i)).toHaveAttribute(
      'type',
      'text'
    );
    fireEvent.click(
      screen.getByRole('button', { name: /queue for delivery/i })
    );

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/admin/notifications',
        expect.objectContaining({ action_url: '/dashboard/orders' })
      );
    });
  });

  it('rejects a scheduled broadcast whose time elapsed while the form was open', async () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2099-01-01T00:00:00Z').getTime());
    render(<CreateNotificationPageClient canTargetSpecificMerchants />);
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'Baci will run maintenance tonight.' },
    });
    fireEvent.click(screen.getByLabelText(/schedule for later/i));
    const scheduleDateInput = await screen.findByLabelText(
      /schedule date and time/i
    );
    fireEvent.change(scheduleDateInput, {
      target: { value: '2099-01-01T00:01' },
    });
    await waitFor(() => {
      expect(scheduleDateInput).toHaveValue('2099-01-01T00:01');
    });
    nowSpy.mockReturnValue(new Date('2099-01-01T00:02:00Z').getTime());
    fireEvent.submit(
      screen
        .getByRole('button', { name: /schedule notification/i })
        .closest('form') as HTMLFormElement
    );
    expect(mockToast).toHaveBeenCalledWith({
      description: 'Please select a future schedule date and time',
      title: 'Error',
      variant: 'destructive',
    });
    expect(mockApiPost).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});
