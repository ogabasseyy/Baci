import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { GadgetDefaultTemplate } from './gadget-default-template';

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

vi.mock('@/components/storefront/blocks/announcement-bar', () => ({
  AnnouncementBar: () => <div data-testid="announcement-bar" />,
}));

vi.mock('@/components/storefront/blocks/header', () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock('@/components/storefront/blocks/footer', () => ({
  Footer: () => <footer data-testid="footer" />,
}));

vi.mock('@/components/storefront/blocks/newsletter', () => ({
  Newsletter: () => <div data-testid="newsletter" />,
}));

vi.mock('@/components/storefront/product-grid', () => ({
  StorefrontProductGrid: () => <div data-testid="product-grid" />,
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    merchant: {
      id: 'm1',
      business_name: 'Gadget Store',
      business_type: 'ELECTRONICS',
    },
    basePath: '/gadgets',
  }),
}));

let selectChangeHandler: (val: string) => void = () => {};

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
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
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('GadgetDefaultTemplate', () => {
  it('renders hero, browse rail, product grid and footer', () => {
    render(
      <GadgetDefaultTemplate
        products={[
          {
            id: 'p1',
            name: 'MacBook Pro',
            price: 2000000,
            brand: 'Apple',
          } as unknown as Product,
        ]}
      />
    );

    expect(screen.getByTestId('announcement-bar')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Gadget Store' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /shop now/i })).toHaveAttribute(
      'href',
      '/gadgets/products'
    );
    expect(
      screen.getByRole('heading', { level: 2, name: /shop by/i })
    ).toBeInTheDocument();
    act(() => {
      selectChangeHandler('brand');
    });
    expect(screen.getByRole('link', { name: 'Apple' })).toHaveAttribute(
      'href',
      '/gadgets/search?q=Apple'
    );
    expect(screen.getByTestId('product-grid')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });
});
