import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NavbarNotificationsPanel } from './navbar-notifications-panel';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../components/empty-state', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('NavbarNotificationsPanel', () => {
  it('renders an accessible notifications region with the empty state', () => {
    render(
      <NavbarNotificationsPanel basePath="/ogabassey" onClose={vi.fn()} />
    );

    expect(
      screen.getByRole('region', { name: /notifications/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Notifications' })
    ).toBeInTheDocument();
    expect(screen.getByText('No Notifications')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /notifications/i })
    ).toHaveClass('w-[min(20rem,calc(100vw-2rem))]');
    expect(
      screen.getByRole('region', { name: /notifications/i })
    ).toHaveClass('md:w-80');
  });

  it('links to the account page and closes after selection', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <NavbarNotificationsPanel basePath="/ogabassey" onClose={onClose} />
    );

    const viewAllLink = screen.getByRole('link', { name: 'View All' });

    expect(viewAllLink).toHaveAttribute('href', '/ogabassey/account');

    await user.click(viewAllLink);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <NavbarNotificationsPanel basePath="/ogabassey" onClose={onClose} />
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
