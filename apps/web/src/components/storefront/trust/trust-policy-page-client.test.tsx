import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrustPolicyPageClient } from './trust-policy-page-client';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('TrustPolicyPageClient', () => {
  it('renders the returns trust policy facts and contact link', () => {
    render(
      <TrustPolicyPageClient
        kind="returns"
        merchantName="Ogabassey"
        contactHref="/contact"
        trustProfile={{
          returnPolicy: {
            summary: 'Returns accepted for defective items.',
            windowDays: 7,
            returnMethod: 'mail',
            returnFees: 'free',
            localRoute: '/returns',
          },
          socialLinks: {},
          derivedLinks: {},
        }}
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Returns Policy' })
    ).toBeInTheDocument();
    expect(screen.getByText('Ogabassey')).toBeInTheDocument();
    expect(
      screen.getByText('Returns accepted for defective items.')
    ).toBeInTheDocument();
    expect(screen.getByText('Return window')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('Return method')).toBeInTheDocument();
    expect(screen.getByText('Mail')).toBeInTheDocument();
    expect(screen.getByText('Return fees')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Before you request a return' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/confirm the current return window/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contact us/i })).toHaveAttribute(
      'href',
      '/contact'
    );
  });

  it('renders the shipping trust policy facts', () => {
    render(
      <TrustPolicyPageClient
        kind="shipping"
        merchantName="Ogabassey"
        contactHref="/contact"
        trustProfile={{
          shippingPolicy: {
            summary: 'Nationwide delivery available.',
            regions: ['Nigeria', 'Ghana'],
            handlingDaysMin: 0,
            handlingDaysMax: 1,
            transitDaysMin: 1,
            transitDaysMax: 5,
            shippingFeeType: 'calculated',
            localRoute: '/shipping',
          },
          socialLinks: {},
          derivedLinks: {},
        }}
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Shipping Policy' })
    ).toBeInTheDocument();
    expect(screen.getByText('Regions')).toBeInTheDocument();
    expect(screen.getByText('Nigeria, Ghana')).toBeInTheDocument();
    expect(screen.getByText('Handling time')).toBeInTheDocument();
    expect(screen.getByText('0-1 business days')).toBeInTheDocument();
    expect(screen.getByText('Transit time')).toBeInTheDocument();
    expect(screen.getByText('1-5 business days')).toBeInTheDocument();
    expect(screen.getByText('Shipping fees')).toBeInTheDocument();
    expect(screen.getByText('Calculated')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'How delivery works' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/confirm the delivery regions/i)
    ).toBeInTheDocument();
  });

  it('renders the warranty trust policy facts', () => {
    render(
      <TrustPolicyPageClient
        kind="warranty"
        merchantName="Ogabassey"
        contactHref="/contact"
        trustProfile={{
          warrantyPolicy: {
            summary: 'Manufacturer warranty applies.',
            localRoute: '/warranty',
          },
          socialLinks: {},
          derivedLinks: {},
        }}
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Warranty Policy' })
    ).toBeInTheDocument();
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.queryByText(/usually excludes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unauthorized repairs/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Manufacturer warranty applies.')).toHaveLength(
      2
    );
  });

  it('omits the contact CTA when contactHref is absent', () => {
    render(
      <TrustPolicyPageClient
        kind="returns"
        merchantName="Ogabassey"
        contactHref={undefined as unknown as string}
        trustProfile={{
          returnPolicy: {
            summary: 'Returns accepted for defective items.',
            windowDays: 7,
            localRoute: '/returns',
          },
          socialLinks: {},
          derivedLinks: {},
        }}
      />
    );

    expect(
      screen.queryByRole('link', { name: /contact us/i })
    ).not.toBeInTheDocument();
  });

  it('uses support-first return guidance when no return policy is configured', () => {
    render(
      <TrustPolicyPageClient
        kind="returns"
        merchantName="General Store"
        contactHref="/contact"
        trustProfile={{
          socialLinks: {},
          derivedLinks: {},
        }}
      />
    );

    expect(screen.getAllByText('Not specified')).toHaveLength(3);
    expect(
      screen.getByRole('heading', {
        name: 'Before you contact support about a return',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not fully specified on this page yet/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/confirm the current return window/i)
    ).not.toBeInTheDocument();
  });
});
