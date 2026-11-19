import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NavbarNotifications } from './navbar-notifications';

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

vi.mock('./navbar-notifications-panel', () => ({
  NavbarNotificationsPanel: ({
    basePath,
    onClose,
  }: {
    basePath: string;
    onClose: () => void;
  }) => (
    <div>
      <h3>Notifications</h3>
      <div>No Notifications</div>
      <a href={`${basePath}/account`} onClick={onClose}>
        View All
      </a>
    </div>
  ),
}));

describe('NavbarNotifications', () => {
  it('toggles the notification panel and links to the account page', async () => {
    const user = userEvent.setup();

    render(<NavbarNotifications basePath="/ogabassey" />);

    await user.click(
      screen.getByRole('button', { name: /toggle notifications/i })
    );

    expect(await screen.findByText('Notifications')).toBeInTheDocument();
    expect(await screen.findByText('No Notifications')).toBeInTheDocument();
    const viewAll = screen.getByRole('link', { name: 'View All' });
    expect(viewAll).toHaveAttribute('href', '/ogabassey/account');

    await user.click(viewAll);

    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('closes the notification panel when the user clicks outside', async () => {
    const user = userEvent.setup();

    render(<NavbarNotifications basePath="/ogabassey" />);

    await user.click(
      screen.getByRole('button', { name: /toggle notifications/i })
    );
    expect(await screen.findByText('Notifications')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('uses desktop-only relative positioning on the container so mobile anchors to the actions bar', () => {
    const { container } = render(<NavbarNotifications basePath="/ogabassey" />);
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveClass('md:relative');
    expect(wrapper?.className.split(' ')).not.toContain('relative');
  });
});
