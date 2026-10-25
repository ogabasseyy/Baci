import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must be hoisted before the component import
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({ basePath: '/test-store' })),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // biome-ignore lint/performance/noImgElement: mock only
    <img src={src} alt={alt} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// SafeHtml renders sanitized HTML into a div — keep it lightweight for tests
vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: ({ html, className }: { html: string; className?: string }) => (
    <div className={className} data-testid="safe-html">
      {html}
    </div>
  ),
}));

import { OgabasseyV2AboutUs } from './about-us';

describe('OgabasseyV2AboutUs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // about-us calls window.scrollTo in a useEffect
    window.scrollTo = vi.fn();
  });

  describe('with full merchant data', () => {
    const merchant = {
      business_name: 'TechHub Africa',
      business_address: 'Abuja, Nigeria',
      about_page: {
        headline: 'Empowering the Continent',
        story: '<p>We started in 2019 with a mission to make gadgets affordable.</p>',
        image_url: 'https://example.com/team.jpg',
      },
    };

    it('renders the page heading', () => {
      // Arrange + Act
      render(<OgabasseyV2AboutUs merchant={merchant} />);

      // Assert
      expect(
        screen.getByRole('heading', { level: 1 }),
      ).toHaveTextContent('Empowering the Continent');
    });

    it('renders story text via SafeHtml', () => {
      render(<OgabasseyV2AboutUs merchant={merchant} />);

      const safeHtmlNode = screen.getByTestId('safe-html');
      expect(safeHtmlNode).toBeInTheDocument();
      expect(safeHtmlNode).toHaveTextContent(
        'We started in 2019 with a mission to make gadgets affordable.',
      );
    });

    it('renders location from merchant business_address', () => {
      render(<OgabasseyV2AboutUs merchant={merchant} />);

      expect(screen.getByText('Abuja, Nigeria')).toBeInTheDocument();
    });

    it('renders the CTA link to the storefront', () => {
      render(<OgabasseyV2AboutUs merchant={merchant} />);

      const ctaLink = screen.getByRole('link', { name: /start shopping/i });
      expect(ctaLink).toBeInTheDocument();
    });
  });

  describe('without merchant data (fallback defaults)', () => {
    it('renders without crashing when no merchant prop is passed', () => {
      render(<OgabasseyV2AboutUs />);

      expect(
        screen.getByRole('heading', { level: 1 }),
      ).toBeInTheDocument();
    });

    it('uses the default headline when about_page is absent', () => {
      render(<OgabasseyV2AboutUs />);

      expect(
        screen.getByRole('heading', { level: 1 }),
      ).toHaveTextContent('Making Tech Accessible & Affordable');
    });

    it('renders the fallback story text via SafeHtml', () => {
      render(<OgabasseyV2AboutUs />);

      const safeHtmlNode = screen.getByTestId('safe-html');
      expect(safeHtmlNode).toBeInTheDocument();
      expect(safeHtmlNode.textContent).toContain('premier destination');
    });

    it('uses the default location when no business_address is provided', () => {
      render(<OgabasseyV2AboutUs />);

      expect(screen.getByText('Lagos, Nigeria')).toBeInTheDocument();
    });

    it('falls back to legacy pages.about content when present', () => {
      const merchantWithLegacy = {
        pages: { about: '<p>Legacy about content</p>' },
      };
      render(<OgabasseyV2AboutUs merchant={merchantWithLegacy} />);

      const safeHtmlNode = screen.getByTestId('safe-html');
      expect(safeHtmlNode).toHaveTextContent('Legacy about content');
    });
  });

  describe('static sections', () => {
    it('omits unsubstantiated customer, sales and certification claims', () => {
      render(<OgabasseyV2AboutUs />);
      expect(screen.queryByText('Happy Customers')).not.toBeInTheDocument();
      expect(screen.queryByText('120k+')).not.toBeInTheDocument();
      expect(screen.queryByText('Certified Pre-Owned Devices')).not.toBeInTheDocument();
    });

    it('renders the three core value headings', () => {
      render(<OgabasseyV2AboutUs />);

      expect(screen.getByRole('heading', { name: 'Quality First' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Customer Obsession' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Accessibility' })).toBeInTheDocument();
    });

    it('renders the "Why We Do What We Do" section heading', () => {
      render(<OgabasseyV2AboutUs />);

      expect(
        screen.getByRole('heading', { name: 'Why We Do What We Do' }),
      ).toBeInTheDocument();
    });
  });
});
