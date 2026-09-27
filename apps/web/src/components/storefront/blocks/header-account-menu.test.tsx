import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'>) => (
    // biome-ignore lint/performance/noImgElement: test double
    <img {...props} alt={props.alt ?? ''} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { HeaderAccountMenu } from './header-account-menu';

describe('HeaderAccountMenu', () => {
  const getHref = (path: string) => `/test-merchant${path}`;

  it('opens the signed-in menu with profile links and sign out', async () => {
    const onLogout = vi.fn();
    render(
      <HeaderAccountMenu
        customerSession={{
          authenticated: true,
          customer: {
            first_name: 'Ada',
            last_name: 'Obi',
            email: 'ada@example.com',
          },
        }}
        getHref={getHref}
        onLogout={onLogout}
      />
    );

    // Radix opens on pointer interaction, not click alone in jsdom.
    // pointerDown opens the menu synchronously and Radix then hides the
    // trigger from the a11y tree, so don't re-query it afterwards.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'User account' }));

    expect(await screen.findByText('Ada Obi')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    // Radix renders items with role="menuitem", overriding the anchor's
    // implicit link role; the href still lands on the rendered <a>.
    expect(
      screen.getByRole('menuitem', { name: 'My Account' })
    ).toHaveAttribute('href', '/test-merchant/account');
    expect(
      screen.getByRole('menuitem', { name: 'Orders' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sign out'));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('renders the sign-in link when signed out', () => {
    render(
      <HeaderAccountMenu
        customerSession={null}
        getHref={getHref}
        onLogout={vi.fn()}
      />
    );

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/test-merchant/account/login'
    );
    expect(
      screen.queryByRole('button', { name: 'User account' })
    ).not.toBeInTheDocument();
  });
});
