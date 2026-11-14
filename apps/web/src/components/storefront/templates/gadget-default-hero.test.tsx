import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { IndustryTheme } from '@/hooks/use-industry-theme';
import { GadgetDefaultHero } from './gadget-default-hero';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    rel,
    className,
  }: {
    children: ReactNode;
    href: string;
    rel?: string;
    className?: string;
  }) => (
    <a href={href} rel={rel} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => (
    <span role="img" data-src={src} aria-label={alt} className={className} />
  ),
}));

const mockTheme: IndustryTheme = {
  id: 'electronics',
  vibe: 'Cyber/Tech',
  radius: 'md',
  colors: {
    primary: '#2563EB',
    accent: '#38BDF8',
    background: '#FFFFFF',
    card: '#F8FAFC',
    text: '#0F172A',
  },
  layout: {
    hero: 'full',
    categoryRail: 'circle',
    productCard: 'bordered',
  },
  icons: {
    primary: (() => null) as unknown as IndustryTheme['icons']['primary'],
    secondary: (() => null) as unknown as IndustryTheme['icons']['secondary'],
    tertiary: (() => null) as unknown as IndustryTheme['icons']['tertiary'],
  },
};

describe('GadgetDefaultHero', () => {
  it('renders full hero layout with /products CTA link', () => {
    render(
      <GadgetDefaultHero
        businessName="TechZone"
        businessType="ELECTRONICS"
        basePath="/techzone"
        theme={mockTheme}
        radiusClass="rounded-md"
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'TechZone' })
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /shop now/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/techzone/products');
  });

  it('renders split hero layout with /products CTA link', () => {
    const splitTheme: IndustryTheme = {
      ...mockTheme,
      layout: {
        ...mockTheme.layout,
        hero: 'split',
      },
    };

    render(
      <GadgetDefaultHero
        businessName="SplitGadgets"
        businessType="ELECTRONICS"
        basePath=""
        theme={splitTheme}
        radiusClass="rounded-md"
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'SplitGadgets' })
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /explore collection/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/products');
  });
});
