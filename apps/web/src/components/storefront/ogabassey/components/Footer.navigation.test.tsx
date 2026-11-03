import { render, screen } from '@testing-library/react';
import type React from 'react';
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

describe('Ogabassey Footer Navigation & Landmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes core catalog and utility internal links in the Menu section and a screen-reader h2 landmark heading', () => {
    mockBuildMerchantTrustProfile.mockReturnValue({
      socialLinks: {},
      derivedLinks: {},
    });

    render(<Footer storeSlug="ogabassey" merchant={merchantFixture} />);

    expect(
      screen.getByRole('heading', { level: 2, name: /ogabassey footer/i })
    ).toHaveClass('sr-only');
    expect(screen.getByRole('link', { name: 'All Products' })).toHaveAttribute(
      'href',
      '/ogabassey/products'
    );
    expect(
      screen.getByRole('link', { name: 'Swap / Trade-in' })
    ).toHaveAttribute('href', '/ogabassey/swap');
    expect(screen.getByRole('link', { name: 'IMEI Checker' })).toHaveAttribute(
      'href',
      '/ogabassey/imei-check'
    );
  });
});
