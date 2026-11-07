import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { IndustryTheme } from '@/hooks/use-industry-theme';
import { GadgetDefaultBrowseRail } from './gadget-default-browse-rail';

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

let selectChangeHandler: (val: string) => void = () => {};

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (val: string) => void;
  }) => {
    if (onValueChange) {
      selectChangeHandler = onValueChange;
    }
    return <div>{children}</div>;
  },
  SelectTrigger: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <button type="button" onClick={() => selectChangeHandler(value)}>
      {children}
    </button>
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

describe('GadgetDefaultBrowseRail', () => {
  it('renders categories by default without nofollow', () => {
    render(
      <GadgetDefaultBrowseRail
        basePath="/techzone"
        theme={mockTheme}
        radiusClass="rounded-md"
      />
    );

    const newArrivals = screen.getByRole('link', { name: /new arrivals/i });
    expect(newArrivals).toBeInTheDocument();
    expect(newArrivals).toHaveAttribute('href', '/techzone/new-arrivals');
    expect(newArrivals).not.toHaveAttribute('rel');
  });

  it('renders brand links with rel="nofollow" pointing to /search?q=', () => {
    render(
      <GadgetDefaultBrowseRail
        products={[{ brand: 'Apple' }, { brand: 'Samsung' }]}
        basePath="/techzone"
        theme={mockTheme}
        radiusClass="rounded-md"
      />
    );

    act(() => {
      selectChangeHandler('brand');
    });

    const appleLink = screen.getByRole('link', { name: 'Apple' });
    expect(appleLink).toBeInTheDocument();
    expect(appleLink).toHaveAttribute('href', '/techzone/search?q=Apple');
    expect(appleLink).toHaveAttribute('rel', 'nofollow');

    const samsungLink = screen.getByRole('link', { name: 'Samsung' });
    expect(samsungLink).toBeInTheDocument();
    expect(samsungLink).toHaveAttribute('href', '/techzone/search?q=Samsung');
    expect(samsungLink).toHaveAttribute('rel', 'nofollow');
  });

  it('renders fallback when no brands are available', () => {
    render(
      <GadgetDefaultBrowseRail
        products={[]}
        basePath="/techzone"
        theme={mockTheme}
        radiusClass="rounded-md"
      />
    );

    act(() => {
      selectChangeHandler('brand');
    });

    expect(screen.getByText('No brands found.')).toBeInTheDocument();
  });

  it('renders price range links with rel="nofollow" pointing to /search', () => {
    render(
      <GadgetDefaultBrowseRail
        basePath=""
        theme={mockTheme}
        radiusClass="rounded-md"
      />
    );

    act(() => {
      selectChangeHandler('price');
    });

    for (const [label, expectedHref] of [
      ['Under ₦5,000', '/search?max_price=5000'],
      ['₦5,000 - ₦20,000', '/search?min_price=5000&max_price=20000'],
      ['₦20,000 - ₦50,000', '/search?min_price=20000&max_price=50000'],
      ['Over ₦50,000', '/search?min_price=50000'],
    ] as const) {
      const link = screen.getByRole('link', { name: label });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', expectedHref);
      expect(link).toHaveAttribute('rel', 'nofollow');
    }
  });

  it('applies border-gray-200 for standard themes and border-zinc-800 for dark themes', () => {
    const { rerender } = render(
      <GadgetDefaultBrowseRail
        basePath="/techzone"
        theme={mockTheme}
        radiusClass="rounded-md"
      />
    );

    const standardLink = screen.getByRole('link', { name: /new arrivals/i });
    expect(standardLink).toHaveClass('border-gray-200');
    expect(standardLink).not.toHaveClass('border-zinc-800');

    rerender(
      <GadgetDefaultBrowseRail
        basePath="/techzone"
        theme={{ ...mockTheme, id: 'hair-extensions' }}
        radiusClass="rounded-md"
      />
    );

    const darkLink = screen.getByRole('link', { name: /new arrivals/i });
    expect(darkLink).toHaveClass('border-zinc-800');
    expect(darkLink).not.toHaveClass('border-gray-200');
  });
});
