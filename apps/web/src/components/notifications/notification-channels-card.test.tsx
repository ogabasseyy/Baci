import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationPreferences } from '@/types/notifications';
import { NotificationChannelsCard } from './notification-channels-card';

vi.mock('@/components/ui/card', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Card: Wrapper,
    CardContent: Wrapper,
    CardDescription: Wrapper,
    CardHeader: Wrapper,
    CardTitle: Wrapper,
  };
});

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    id,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    id?: string;
    onCheckedChange: (checked: boolean) => void;
    'aria-label'?: string;
  }) => (
    <button
      {...props}
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

vi.mock('lucide-react', () => ({
  Bell: () => null,
}));

const preferences = {
  merchant_id: 'merchant-1',
  banner_enabled: true,
  follow_up_notifications_enabled: true,
  in_app_enabled: true,
  quiet_hours_end: null,
  quiet_hours_start: null,
  quiet_hours_time_zone: 'Africa/Lagos',
  updated_at: '2026-08-27T00:00:00.000Z',
} satisfies NotificationPreferences;

describe('NotificationChannelsCard', () => {
  it('forwards channel changes, including follow-up alerts', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <NotificationChannelsCard onUpdate={onUpdate} preferences={preferences} />
    );

    await user.click(screen.getByRole('switch', { name: 'Follow-up alerts' }));

    expect(onUpdate).toHaveBeenCalledWith({
      follow_up_notifications_enabled: false,
    });
  });
});
