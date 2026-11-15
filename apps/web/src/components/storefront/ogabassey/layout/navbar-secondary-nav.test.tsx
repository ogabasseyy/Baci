import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NavbarSecondaryNav } from './navbar-secondary-nav';

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

describe('NavbarSecondaryNav', () => {
  it('renders category and utility links under the store base path', async () => {
    const user = userEvent.setup();

    render(
      <NavbarSecondaryNav
        basePath="/ogabassey"
        categories={[{ name: 'Phones', slug: 'smartphones' }]}
      />
    );

    await user.click(screen.getByRole('button', { name: /shop by category/i }));

    expect(await screen.findByRole('link', { name: 'Phones' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones'
    );
    expect(screen.getByRole('link', { name: /imei checker/i })).toHaveAttribute(
      'href',
      '/ogabassey/imei-check'
    );
    expect(
      screen.getByRole('link', { name: /swap \/ trade-in/i })
    ).toHaveAttribute('href', '/ogabassey/swap');
    expect(screen.getByRole('link', { name: /blog/i })).toHaveAttribute(
      'href',
      '/ogabassey/blog'
    );
  });

  it('connects the category disclosure button to the dropdown panel', async () => {
    const user = userEvent.setup();

    render(
      <NavbarSecondaryNav
        basePath="/ogabassey"
        categories={[{ name: 'Phones', slug: 'smartphones' }]}
      />
    );

    const trigger = screen.getByRole('button', { name: /shop by category/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    const panel = await screen.findByRole('region', {
      name: /category navigation/i,
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
  });

  it('normalizes legacy phone aliases to the smartphones route', async () => {
    const user = userEvent.setup();

    render(
      <NavbarSecondaryNav
        basePath="/ogabassey"
        categories={[{ name: 'Phones', slug: 'phones' }]}
      />
    );

    await user.click(screen.getByRole('button', { name: /shop by category/i }));

    expect(await screen.findByRole('link', { name: 'Phones' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones'
    );
    expect(screen.getByRole('link', { name: /imei checker/i })).toHaveAttribute(
      'href',
      '/ogabassey/imei-check'
    );
    expect(
      screen.getByRole('link', { name: /swap \/ trade-in/i })
    ).toHaveAttribute('href', '/ogabassey/swap');
    expect(screen.getByRole('link', { name: /blog/i })).toHaveAttribute(
      'href',
      '/ogabassey/blog'
    );
  });

  it('shows a loading placeholder when categories are not available yet', async () => {
    const user = userEvent.setup();

    render(<NavbarSecondaryNav basePath="/ogabassey" categories={[]} />);

    await user.click(screen.getByRole('button', { name: /shop by category/i }));

    expect(await screen.findByText('Loading categories…')).toBeInTheDocument();
  });

  it('closes the category dropdown when the user clicks outside', async () => {
    const user = userEvent.setup();

    render(
      <NavbarSecondaryNav
        basePath="/ogabassey"
        categories={[{ name: 'Phones', slug: 'phones' }]}
      />
    );

    await user.click(screen.getByRole('button', { name: /shop by category/i }));
    expect(
      await screen.findByRole('link', { name: 'Phones' })
    ).toBeInTheDocument();

    await user.click(document.body);

    expect(
      screen.queryByRole('link', { name: 'Phones' })
    ).not.toBeInTheDocument();
  });

  it('renders the decorative background pattern as an inline SVG tile, not a background-image div', () => {
    // Regression guard mirroring GadgetPattern.test.tsx: a
    // `background-image: url(data:image/svg+xml,...)` div IS an LCP
    // candidate. This is the fast-follow to #3044, which fixed the same bug
    // in GadgetPattern but not in this hand-rolled copy.
    const { container } = render(
      <NavbarSecondaryNav
        basePath="/ogabassey"
        categories={[{ name: 'Phones', slug: 'smartphones' }]}
      />
    );

    const pattern = container.querySelector(
      '.ogabassey-navbar-secondary__pattern'
    );
    expect(pattern).not.toBeNull();
    expect(pattern?.tagName.toLowerCase()).toBe('svg');

    const tile = pattern?.querySelector('pattern');
    expect(tile).not.toBeNull();
    expect(tile).toHaveAttribute('width', '140');
    expect(tile).toHaveAttribute('height', '140');

    const fillRect = pattern?.querySelector(`rect[fill="url(#${tile?.id})"]`);
    expect(fillRect).not.toBeNull();

    const style = pattern?.getAttribute('style') ?? '';
    expect(style).not.toContain('background');
    expect(style).not.toContain('data:image/svg+xml');
  });
});
