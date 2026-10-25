import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: ({ html, className }: { html: string; className?: string }) => (
    <article className={className} aria-label="sanitized content">
      {html}
    </article>
  ),
}));

import { OgabasseyV2LegalDispute } from './legal-dispute';

describe('OgabasseyV2LegalDispute', () => {
  describe('server component (render-weight)', () => {
    it('is a Server Component so the sanitizer stays out of the client bundle', () => {
      // The 'use client' directive must only appear at module top when present.
      // Its absence keeps SafeHtml/sanitize-html server-only for this route.
      const source = readFileSync(
        `${process.cwd()}/src/components/storefront/ogabassey/pages/legal-dispute.tsx`,
        'utf8'
      );

      expect(source).not.toMatch(/^\s*['"]use client['"]/m);
    });
  });

  describe('page structure', () => {
    it('renders the main page heading', () => {
      render(<OgabasseyV2LegalDispute />);

      expect(
        screen.getByRole('heading', { level: 1 }),
      ).toHaveTextContent('Legal & Dispute Resolution');
    });

    it('renders the approved returns note for Ogabassey', () => {
      render(<OgabasseyV2LegalDispute merchant={{ slug: 'ogabassey' }} />);

      expect(
        screen.getByRole('heading', { name: /important note on returns/i }),
      ).toBeInTheDocument();
    });

    it('always renders the legal contact section', () => {
      render(<OgabasseyV2LegalDispute />);

      expect(
        screen.getByRole('heading', { name: /legal contact/i }),
      ).toBeInTheDocument();
    });
  });

  describe('default content (no merchant pages.terms)', () => {
    it('renders without crashing when no merchant prop is provided', () => {
      render(<OgabasseyV2LegalDispute />);

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('renders all four default section headings', () => {
      render(<OgabasseyV2LegalDispute />);

      expect(
        screen.getByRole('heading', { name: 'Terms of Service' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Dispute Resolution Policy' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Limitation of Liability' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Governing Law' }),
      ).toBeInTheDocument();
    });

    it('does not render a SafeHtml node when there is no custom content', () => {
      render(<OgabasseyV2LegalDispute />);

      expect(screen.queryByRole('article', { name: /sanitized content/i })).not.toBeInTheDocument();
    });

    it('uses the default business name in the intro text', () => {
      render(<OgabasseyV2LegalDispute />);

      expect(screen.getByText(/at ogabassey limited/i)).toBeInTheDocument();
    });

    it('uses the default email in contact links', () => {
      render(<OgabasseyV2LegalDispute />);

      const emailLinks = screen.getAllByRole('link', {
        name: 'support@ogabassey.com',
      });
      expect(emailLinks.length).toBeGreaterThanOrEqual(1);
      expect(emailLinks[0]).toHaveAttribute(
        'href',
        'mailto:support@ogabassey.com',
      );
    });

    it('renders the default business_address', () => {
      render(<OgabasseyV2LegalDispute />);

      expect(
        screen.getByText(/2 Olaide Tomori St, Ikeja, Lagos, Nigeria/i),
      ).toBeInTheDocument();
    });
  });

  describe('custom content via merchant.pages.terms', () => {
    const merchantWithCustomTerms = {
      business_name: 'GadgetWorld',
      email: 'legal@gadgetworld.com',
      business_address: 'Plot 5, Victoria Island, Lagos',
      pages: {
        terms: '<p>Custom terms and conditions for GadgetWorld customers.</p>',
      },
    };

    it('renders the custom terms content via SafeHtml', () => {
      render(<OgabasseyV2LegalDispute merchant={merchantWithCustomTerms} />);

      const safeHtmlNode = screen.getByRole('article', { name: /sanitized content/i });
      expect(safeHtmlNode).toBeInTheDocument();
      expect(safeHtmlNode).toHaveTextContent(
        'Custom terms and conditions for GadgetWorld customers.',
      );
    });

    it('does not render the default section headings when custom content is set', () => {
      render(<OgabasseyV2LegalDispute merchant={merchantWithCustomTerms} />);

      expect(
        screen.queryByRole('heading', { name: 'Terms of Service' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Dispute Resolution Policy' }),
      ).not.toBeInTheDocument();
    });

    it('renders merchant email in the legal contact section', () => {
      render(<OgabasseyV2LegalDispute merchant={merchantWithCustomTerms} />);

      const emailLinks = screen.getAllByRole('link', {
        name: 'legal@gadgetworld.com',
      });
      expect(emailLinks.length).toBeGreaterThanOrEqual(1);
    });

    it('renders merchant business_address in the legal contact section', () => {
      render(<OgabasseyV2LegalDispute merchant={merchantWithCustomTerms} />);

      expect(
        screen.getByText('Plot 5, Victoria Island, Lagos'),
      ).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('renders correctly when merchant has no pages key', () => {
      render(<OgabasseyV2LegalDispute merchant={{ business_name: 'Acme' }} />);

      // Falls back to default sections
      expect(
        screen.getByRole('heading', { name: 'Terms of Service' }),
      ).toBeInTheDocument();
    });

    it('renders correctly when merchant.pages.terms is an empty string', () => {
      const merchant = {
        pages: { terms: '' },
      };
      render(<OgabasseyV2LegalDispute merchant={merchant} />);

      // Empty string is falsy — should fall through to default sections
      expect(
        screen.getByRole('heading', { name: 'Terms of Service' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('article', { name: /sanitized content/i })).not.toBeInTheDocument();
    });
  });
});
