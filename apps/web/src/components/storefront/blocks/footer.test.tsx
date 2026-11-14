import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock('@/components/ui/input', () => ({ Input: () => <input /> }));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '/merchant' }),
}));

import { Footer } from './footer';

describe('Footer', () => {
  it('scopes AI-authored root-relative quick links to the merchant storefront', () => {
    render(
      <Footer
        quickLinks={[{ label: 'Sale', url: '/sale' }]}
        showNewsletter={false}
      />
    );

    expect(screen.getByRole('link', { name: 'Sale' })).toHaveAttribute(
      'href',
      '/merchant/sale'
    );
  });

  it('renders external social links with safe target and rel attributes', () => {
    render(
      <Footer
        socialLinks={{
          instagram: 'https://instagram.com/ogabassey',
        }}
        showNewsletter={false}
      />
    );

    const socialLink = screen.getByRole('link', { name: 'instagram' });
    expect(socialLink).toHaveAttribute(
      'href',
      'https://instagram.com/ogabassey'
    );
    expect(socialLink).toHaveAttribute('target', '_blank');
    expect(socialLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits social links for unknown platforms, empty URLs, or non-http schemes while keeping valid links', () => {
    const socialLinks = {
      facebook: '',
      instagram: 'javascript:alert(1)',
      tiktok: 'https://www.tiktok.com/@ogabassey',
      youtube: 'https://youtube.com/@ogabassey',
    } as Record<string, string>;

    render(
      <Footer
        socialLinks={socialLinks}
        showQuickLinks={false}
        showNewsletter={false}
      />
    );

    expect(
      screen.queryAllByRole('link', { name: /facebook|instagram|tiktok/i })
    ).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'youtube' })).toHaveAttribute(
      'href',
      'https://youtube.com/@ogabassey'
    );
  });
});
