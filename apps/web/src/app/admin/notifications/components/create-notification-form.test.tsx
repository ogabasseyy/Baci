import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CreateNotificationInput } from '@/types/notifications';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('./create-notification-audience-delivery', () => ({
  CreateNotificationAudienceDelivery: () => (
    <div data-testid="audience-delivery" />
  ),
}));

vi.mock('./create-notification-select', () => ({
  CreateNotificationSelect: () => <div data-testid="notification-select" />,
}));

import { CreateNotificationForm } from './create-notification-form';

const formData: CreateNotificationInput = {
  channels: ['in_app'],
  message: '',
  notification_type: 'warning',
  priority: 'normal',
  target_type: 'all',
  title: '',
};

function renderForm(overrides: Partial<CreateNotificationInput> = {}) {
  const props = {
    canTargetSpecificMerchants: true,
    expiresEnabled: false,
    formData: { ...formData, ...overrides },
    isSubmitting: false,
    minDateTime: '2026-08-05T12:00',
    onExpiresEnabledChange: vi.fn(),
    onScheduleEnabledChange: vi.fn(),
    onSubmit: vi.fn((event: React.FormEvent) => event.preventDefault()),
    onToggleChannel: vi.fn(),
    onUpdate: vi.fn(),
    scheduleEnabled: false,
  };
  return { ...render(<CreateNotificationForm {...props} />), props };
}

describe('CreateNotificationForm', () => {
  it('updates required content and keeps the preview safe from form submission', () => {
    const { props } = renderForm({ action_label: 'Review downtime' });

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Maintenance' },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: 'The dashboard will be unavailable.' },
    });
    fireEvent.click(screen.getByText('Review downtime'));

    expect(props.onUpdate).toHaveBeenCalledWith({ title: 'Maintenance' });
    expect(props.onUpdate).toHaveBeenCalledWith({
      message: 'The dashboard will be unavailable.',
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('disables submission while a scheduled notification is being queued', () => {
    const { rerender, props } = renderForm();

    rerender(
      <CreateNotificationForm {...props} isSubmitting scheduleEnabled />
    );

    expect(screen.getByRole('button', { name: /scheduling/i })).toBeDisabled();
  });

  it('clears an optional action URL as undefined', () => {
    const { props } = renderForm({ action_url: 'https://baci.example/orders' });

    fireEvent.change(screen.getByLabelText(/action url/i), {
      target: { value: '' },
    });

    expect(props.onUpdate).toHaveBeenCalledWith({ action_url: undefined });
  });
});
