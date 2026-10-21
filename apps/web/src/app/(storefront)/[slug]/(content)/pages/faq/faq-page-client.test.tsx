import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseMerchantSafe = vi.fn(() => ({ basePath: '' as string }));

vi.mock('@/components/app-body', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/storefront/footer', () => ({
  StorefrontFooter: () => <footer data-testid="storefront-footer" />,
}));

vi.mock('@/components/storefront/header', () => ({
  StorefrontHeader: () => null,
}));

vi.mock('@/components/ui/accordion', () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AccordionContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AccordionItem: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: () => null,
}));

vi.mock('@/contexts/storefront-context', () => ({
  StorefrontProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => mockUseMerchantSafe(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { FAQPageClient } from './faq-page-client';

describe('FAQPageClient', () => {
  beforeEach(() => {
    mockUseMerchantSafe.mockReturnValue({ basePath: '' });
  });

  it('exports a valid component', () => {
    expect(FAQPageClient).toBeDefined();
    expect(typeof FAQPageClient).toBe('function');
  });

  it('links the support CTA to the canonical contact route', () => {
    render(
      <FAQPageClient
        merchant={{
          id: 'merchant-1',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
        }}
        faqItems={[
          {
            question: 'Do you offer delivery?',
            answer: 'Yes.',
            category: 'Shipping',
          },
        ]}
      />
    );

    expect(
      screen.getByRole('link', { name: /contact support/i })
    ).toHaveAttribute('href', '/contact');
  });

  it('renders crawl summary children before the storefront footer', () => {
    render(
      <FAQPageClient
        merchant={{
          id: 'merchant-1',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
        }}
        faqItems={[]}
      >
        <section data-testid="crawl-summary">SEO crawl summary</section>
      </FAQPageClient>
    );

    const summary = screen.getByTestId('crawl-summary');
    const footer = screen.getByTestId('storefront-footer');

    expect(
      summary.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('prefixes the contact link with basePath when set', () => {
    mockUseMerchantSafe.mockReturnValueOnce({ basePath: '/ogabassey' });

    render(
      <FAQPageClient
        merchant={{
          id: 'merchant-2',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
        }}
        faqItems={[]}
      />
    );

    expect(
      screen.getByRole('link', { name: /contact support/i })
    ).toHaveAttribute('href', '/ogabassey/contact');
  });
});
