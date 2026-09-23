import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Footer } from './Footer';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    height,
    src,
    width,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    height: number;
    src: string;
    width: number;
  }) => (
    <img
      alt={alt}
      data-height={height}
      data-width={width}
      src={src}
      {...props}
    />
  ),
}));

vi.mock('./Logo', () => ({
  Logo: () => <span>Logo</span>,
}));
const mockBuildMerchantTrustProfile = vi.fn();
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
vi.mock('@/lib/social', () => ({
  normalizeSocialUrl: (value: string | undefined) => value,
}));

const merchantFixture = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  social_media: {},
  email: 'support@ogabassey.com',
  phone: '+2348000000000',
  business_address: 'Lagos',
};

describe('Ogabassey Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses named footer contrast styles instead of generated arbitrary color utilities', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });

    const { container } = render(
      <Footer storeSlug="ogabassey" merchant={merchantFixture} />
    );
    const footer = container.querySelector('footer');

    expect(footer?.className).toContain('ogabassey-footer');
    expect(footer?.className).toContain('border-t');
    expect(footer?.className).toContain('border-store-border/40');
    expect(footer?.className).not.toContain('bg-[color');
    expect(footer?.className).not.toContain('text-[color');
    expect(footer?.className).not.toContain('text-store-primary-text');
  });

  it('renders the branded gadget pattern overlay instead of a dot texture', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });

    render(<Footer storeSlug="ogabassey" merchant={merchantFixture} />);
    const pattern = screen.getByTestId('ogabassey-gadget-pattern');

    expect(pattern).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the merchant-specific business name in the copyright line', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({ socialLinks: {}, derivedLinks: {} });
    render(<Footer storeSlug="other" merchant={{ ...merchantFixture, business_name: 'Acme Devices' }} />);
    expect(screen.getByText(/Acme Devices.*All rights reserved/)).toBeInTheDocument();
  });

  it('adds trust policy links to the support section when available', () => {
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
      warrantyPolicy: {
        summary: 'Warranty',
        localRoute: '/warranty',
      },
      socialLinks: {},
      derivedLinks: {},
    });
    render(
      <Footer
        storeSlug="ogabassey"
        merchant={merchantFixture}
      />
    );

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

  it('omits trust policy links when merchant trust data is missing', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });
    render(
      <Footer
        storeSlug="ogabassey"
        merchant={merchantFixture}
      />
    );

    expect(screen.queryByRole('link', { name: 'Returns' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Shipping' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Warranty' })).toBeNull();
  });

  it('renders Returns when only return method data exists', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      returnPolicy: {
        returnMethod: 'mail',
        returnFees: 'free',
        localRoute: '/returns',
      },
      socialLinks: {},
      derivedLinks: {},
    });
    render(
      <Footer
        storeSlug="ogabassey"
        merchant={merchantFixture}
      />
    );

    expect(screen.getByRole('link', { name: 'Returns' })).toHaveAttribute(
      'href',
      '/ogabassey/returns'
    );
  });

  it('renders Shipping when only handling details exist', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      shippingPolicy: {
        handlingDaysMin: 0,
        shippingFeeType: 'calculated',
        localRoute: '/shipping',
      },
      socialLinks: {},
      derivedLinks: {},
    });
    render(
      <Footer
        storeSlug="ogabassey"
        merchant={merchantFixture}
      />
    );

    expect(screen.getByRole('link', { name: 'Shipping' })).toHaveAttribute(
      'href',
      '/ogabassey/shipping'
    );
  });

  it('shows the public support_email (not the account email) as the contact link', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });
    render(
      <Footer
        storeSlug="ogabassey"
        merchant={{
          ...merchantFixture,
          email: 'account-private@gmail.com',
          support_email: 'hello@ogabassey.com',
        }}
      />
    );

    expect(
      screen.getByRole('link', { name: 'hello@ogabassey.com' })
    ).toHaveAttribute('href', 'mailto:hello@ogabassey.com');
    expect(
      screen.queryByRole('link', { name: 'account-private@gmail.com' })
    ).toBeNull();
  });

  it('falls back when support contact fields are whitespace-only', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });
    render(
      <Footer
        storeSlug="ogabassey"
        merchant={{
          ...merchantFixture,
          email: ' account-private@gmail.com ',
          support_email: '   ',
          business_address: '   ',
        }}
      />
    );

    expect(
      screen.getByRole('link', { name: 'account-private@gmail.com' })
    ).toHaveAttribute('href', 'mailto:account-private@gmail.com');
    expect(screen.getByText('2 Olaide Tomori St, Ikeja, Lagos')).toBeVisible();
  });

});
