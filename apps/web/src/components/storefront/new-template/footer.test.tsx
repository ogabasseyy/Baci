import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Footer } from './footer';

const mockUseMerchantSafe = vi.fn();

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => mockUseMerchantSafe(),
}));

vi.mock('./logo', () => ({
  Logo: () => <span>logo</span>,
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

const merchant = {
  id: 'merchant-1',
  slug: 'tech-hub',
  business_name: 'Tech Hub',
  legal_entity_name: 'Tech Hub Ltd',
  business_address: '12 Market Rd, Aba',
  support_phone: '+2348000000000',
  support_email: 'help@techhub.ng',
  social_media: {
    instagram: 'https://instagram.com/techhub',
    youtube: 'https://youtube.com/@techhub',
  },
};

describe('gadgets-pro Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMerchantSafe.mockReturnValue({ merchant, basePath: '/tech-hub' });
  });

  it('links only to merchant-scoped routes that exist for every store', () => {
    render(<Footer />);

    expect(screen.getByRole('link', { name: 'Track Order' })).toHaveAttribute(
      'href',
      '/tech-hub/track-order'
    );
    expect(screen.getByRole('link', { name: 'About Us' })).toHaveAttribute(
      'href',
      '/tech-hub/about'
    );
    // Ogabassey-gated routes 404 on other stores and must not be linked.
    expect(screen.queryByRole('link', { name: 'Repairs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sell Device' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sustainability' })).toBeNull();
  });

  it('renders only the social networks the merchant configured', () => {
    render(<Footer />);

    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/techhub'
    );
    expect(screen.getByRole('link', { name: 'YouTube' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Facebook' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Twitter' })).toBeNull();
  });

  it('normalizes bare social handles into absolute profile URLs', () => {
    mockUseMerchantSafe.mockReturnValue({
      merchant: {
        ...merchant,
        social_media: { instagram: '@techhub', facebook: 'techhubng' },
      },
      basePath: '/tech-hub',
    });

    render(<Footer />);

    // A handle must never render as a relative storefront href.
    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/techhub'
    );
    expect(screen.getByRole('link', { name: 'Facebook' })).toHaveAttribute(
      'href',
      'https://www.facebook.com/techhubng'
    );
  });

  it('shows the merchant contact details and legal-entity copyright', () => {
    render(<Footer />);

    expect(screen.getByText('12 Market Rd, Aba')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '+2348000000000' })
    ).toHaveAttribute('href', 'tel:+2348000000000');
    expect(
      screen.getByRole('link', { name: 'help@techhub.ng' })
    ).toHaveAttribute('href', 'mailto:help@techhub.ng');
    expect(screen.getByText(/Tech Hub Ltd\./)).toBeInTheDocument();
  });

  it('omits the contact column and socials when the merchant has none', () => {
    mockUseMerchantSafe.mockReturnValue({
      merchant: {
        ...merchant,
        business_address: undefined,
        support_phone: undefined,
        support_email: undefined,
        social_media: undefined,
      },
      basePath: '/tech-hub',
    });

    render(<Footer />);

    expect(screen.queryByText('Contact')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Instagram' })).toBeNull();
  });
});
