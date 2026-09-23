import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationBell } from './notification-bell';

describe('NotificationBell', () => {
  it('shows the notification dot and wiggle only with a notification', () => {
    const { container, rerender } = render(<NotificationBell size={20} />);

    expect(container.querySelector('.bg-red-500')).toBeNull();

    rerender(<NotificationBell hasNotification size={20} />);
    expect(container.querySelector('.bg-red-500')).not.toBeNull();
    expect(container.innerHTML).toContain('motion-safe:animate-wiggle');
  });
});
