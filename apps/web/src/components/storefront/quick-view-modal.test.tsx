import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { QuickViewModal } from './quick-view-modal';

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('@/components/themed', () => ({
  ThemedBadge: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  ThemedButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({ formatCurrency: (value: number) => `₦${value}` }),
}));
vi.mock('@/hooks/use-cart', () => ({
  useCart: () => ({ addToCart: vi.fn(), setMerchantSlug: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const product: Product = {
  id: 'qa-vase',
  name: 'Minimalist Ceramic Flower Vase',
  slug: 'minimalist-ceramic-flower-vase',
  category: 'Home Decor',
  category_slug: 'home-decor',
  description: 'Vase',
  status: 'active',
  price: 7000,
  manage_stock: true,
  stock: 5,
  image: '/vase.png',
  imageLarge: '/vase.png',
  imageHint: 'Vase',
  brand: 'Home Makeover',
  gtin: '',
  mpn: '',
};

describe('QuickViewModal routing', () => {
  it.each([
    ['', '/home-decor/minimalist-ceramic-flower-vase'],
    [
      '/home-makeover',
      '/home-makeover/home-decor/minimalist-ceramic-flower-vase',
    ],
  ])('uses routing basePath %s independently of merchant cart identity', (basePath, href) => {
    const onClose = vi.fn();
    render(
      <QuickViewModal
        product={product}
        isOpen
        onClose={onClose}
        merchantSlug="home-makeover"
        basePath={basePath}
      />
    );
    const link = screen.getByRole('link', { name: 'View Full Details' });
    expect(link).toHaveAttribute('href', href);
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
