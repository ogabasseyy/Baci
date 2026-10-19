import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { NotificationDetailsNotFoundState } from './notification-details-not-found-state';

describe('NotificationDetailsNotFoundState', () => {
  it('explains the missing record and provides a safe return path', () => {
    render(<NotificationDetailsNotFoundState />);

    expect(
      screen.getByRole('heading', { name: 'Notification Not Found' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to Notifications' })
    ).toHaveAttribute('href', '/admin/notifications');
  });
});
