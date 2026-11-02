import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ogabassey',
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: () => ({
    basePath: '/ogabassey',
    merchant: { business_name: 'Ogabassey' },
    navigationCategories: [{ name: 'Smartphones', slug: 'smartphones' }],
  }),
}));

vi.mock('../layout/logo', () => ({
  Logo: () => <span>Baci</span>,
}));

import {
  MobileMenu,
  OgabasseyMobileMenu,
} from './MobileMenu';
import {
  MobileMenu as CanonicalMobileMenu,
  OgabasseyMobileMenu as CanonicalOgabasseyMobileMenu,
} from '../layout/mobile-menu';

describe('MobileMenu compatibility re-export', () => {
  it('re-exports the canonical layout components by identity', () => {
    expect(MobileMenu).toBe(CanonicalMobileMenu);
    expect(OgabasseyMobileMenu).toBe(CanonicalOgabasseyMobileMenu);
  });

  it('renders through the compatibility MobileMenu export', () => {
    render(<MobileMenu isOpen={true} onClose={vi.fn()} />);

    expect(
      screen.getByRole('dialog', { name: /mobile menu/i })
    ).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/ogabassey'
    );
  });

  it('renders through the compatibility OgabasseyMobileMenu export', () => {
    render(<OgabasseyMobileMenu isOpen={true} onClose={vi.fn()} />);

    expect(
      screen.getByRole('dialog', { name: /mobile menu/i })
    ).toHaveAttribute('aria-modal', 'true');
  });
});
