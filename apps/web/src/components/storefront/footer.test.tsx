import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StorefrontFooter } from './footer';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const mockUseMerchant = vi.fn();
const mockAsRoute = vi.fn((value: string) => value);
const mockBuildMerchantTrustProfile = vi.fn();
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => mockUseMerchant(),
}));
vi.mock('@/lib/routes', () => ({
  asRoute: (value: string) => mockAsRoute(value),
}));
vi.mock(
  '@/lib/storefront-trust/build-merchant-trust-profile',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/storefront-trust/build-merchant-trust-profile')
      >();

    return {
      ...actual,
      buildMerchantTrustProfile: (...args: unknown[]) =>
        mockBuildMerchantTrustProfile(...args),
    };
  }
);

describe('StorefrontFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds trust policy links when derived links exist', () => {
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      merchant: {
        business_name: 'Ogabassey',
        pages: { about: 'About', contact: 'Contact', faq: 'FAQ' },
        support_email: 'support@ogabassey.com',
        support_phone: '+2348000000000',
        business_address: 'Lagos',
      },
    });
    mockBuildMerchantTrustProfile.mockReturnValue({
      returnPolicy: {
        summary: 'Returns',
        windowDays: 7,
        localRoute: '/returns',
      },
      shippingPolicy: {
        summary: 'Shipping',
        regions: ['Nigeria'],
        localRoute: '/shipping',
      },
      warrantyPolicy: { summary: 'Warranty', localRoute: '/warranty' },
      socialLinks: {},
      derivedLinks: {},
    });

    render(<StorefrontFooter />);

    expect(screen.getByRole('link', { name: 'Returns' })).toHaveAttribute(
      'href',
      '/ogabassey/returns'
    );
    expect(screen.getByRole('link', { name: 'Shipping' })).toHaveAttribute(
      'href',
      '/ogabassey/shipping'
    );
    expect(screen.getByRole('link', { name: 'Warranty' })).toHaveAttribute(
      'href',
      '/ogabassey/warranty'
    );
  });

  it('omits trust policy links when no derived links exist', () => {
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      merchant: {
        business_name: 'Ogabassey',
        pages: { about: 'About', contact: 'Contact', faq: 'FAQ' },
        support_email: 'support@ogabassey.com',
        support_phone: '+2348000000000',
        business_address: 'Lagos',
      },
    });
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });

    render(<StorefrontFooter />);

    expect(
      screen.queryByRole('link', { name: 'Returns' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Shipping' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Warranty' })
    ).not.toBeInTheDocument();
  });

  it('renders Returns when only return method data exists', () => {
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      merchant: {
        business_name: 'Ogabassey',
        pages: { about: 'About', contact: 'Contact', faq: 'FAQ' },
        support_email: 'support@ogabassey.com',
        support_phone: '+2348000000000',
        business_address: 'Lagos',
      },
    });
    mockBuildMerchantTrustProfile.mockReturnValue({
      returnPolicy: {
        returnMethod: 'mail',
        returnFees: 'free',
        localRoute: '/returns',
      },
      socialLinks: {},
      derivedLinks: {},
    });

    render(<StorefrontFooter />);

    expect(screen.getByRole('link', { name: 'Returns' })).toHaveAttribute(
      'href',
      '/ogabassey/returns'
    );
  });

  it('renders Shipping when only handling details exist', () => {
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      merchant: {
        business_name: 'Ogabassey',
        pages: { about: 'About', contact: 'Contact', faq: 'FAQ' },
        support_email: 'support@ogabassey.com',
        support_phone: '+2348000000000',
        business_address: 'Lagos',
      },
    });
    mockBuildMerchantTrustProfile.mockReturnValue({
      shippingPolicy: {
        handlingDaysMin: 0,
        shippingFeeType: 'calculated',
        localRoute: '/shipping',
      },
      socialLinks: {},
      derivedLinks: {},
    });

    render(<StorefrontFooter />);

    expect(screen.getByRole('link', { name: 'Shipping' })).toHaveAttribute(
      'href',
      '/ogabassey/shipping'
    );
  });

  it('canonicalizes stored full social URLs to non-redirecting hosts', () => {
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      merchant: {
        business_name: 'Ogabassey',
        social_media: {
          instagram: 'https://instagram.com/ogabasseyy',
          twitter: 'https://twitter.com/ogabasseyy',
          facebook: 'https://facebook.com/ogabasseyyy',
          youtube: 'channel/UC123',
        },
      },
    });
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });

    render(<StorefrontFooter />);

    expect(
      screen.getByRole('link', { name: 'Follow us on Instagram' })
    ).toHaveAttribute('href', 'https://www.instagram.com/ogabasseyy');
    expect(
      screen.getByRole('link', { name: 'Follow us on Twitter' })
    ).toHaveAttribute('href', 'https://x.com/ogabasseyy');
    expect(
      screen.getByRole('link', { name: 'Follow us on Facebook' })
    ).toHaveAttribute('href', 'https://www.facebook.com/ogabasseyyy');
    expect(
      screen.getByRole('link', { name: 'Follow us on YouTube' })
    ).toHaveAttribute('href', 'https://www.youtube.com/channel/UC123');
  });
});
