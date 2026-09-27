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

import { OgabasseyV2PrivacyPolicy } from './privacy-policy';

describe('OgabasseyV2PrivacyPolicy', () => {
  describe('server component (render-weight)', () => {
    it('is a Server Component so the sanitizer stays out of the client bundle', () => {
      // The 'use client' directive must only appear at module top when present.
      // Its absence keeps SafeHtml/sanitize-html server-only for this route.
      const source = readFileSync(
        `${process.cwd()}/src/components/storefront/ogabassey/pages/privacy-policy.tsx`,
        'utf8'
      );

      expect(source).not.toMatch(/^\s*['"]use client['"]/m);
    });
  });

  describe('page structure', () => {
    it('renders the main page heading', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      expect(
        screen.getByRole('heading', { level: 1 }),
      ).toHaveTextContent('Privacy Policy');
    });

    it('always renders the privacy contact section', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      expect(
        screen.getByRole('heading', { name: /contact us regarding privacy/i }),
      ).toBeInTheDocument();
    });
  });

  describe('default content (no merchant pages.privacy)', () => {
    it('states Ogabassey retention periods, ChatGPT handling, and privacy controls', () => {
      render(
        <OgabasseyV2PrivacyPolicy
          merchant={{ slug: 'ogabassey', email: 'privacy@ogabassey.com' }}
        />,
      );

      expect(screen.getByRole('heading', { name: 'How Long We Keep Your Information' })).toBeInTheDocument();
      expect(screen.getByText(/generally limits storage to six calendar months/)).toBeInTheDocument();
      expect(screen.getByText(/reviewing our retention controls/)).toBeInTheDocument();
      expect(screen.queryByText(/we delete or de-identify personal data no later than/)).not.toBeInTheDocument();
      expect(screen.getByText(/at least six years after the year of assessment/)).toBeInTheDocument();
      expect(screen.getByText(/do not create a saved Ogabassey account search history/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Your Privacy Choices' })).toBeInTheDocument();
      expect(screen.getByText(/If you cannot use that address, email us/)).toBeInTheDocument();
      expect(
        screen.getAllByRole('link', { name: 'privacy@ogabassey.com' }),
      ).toHaveLength(2);
    });

    it('does not assign Ogabassey-specific retention promises to another merchant', () => {
      render(<OgabasseyV2PrivacyPolicy merchant={{ slug: 'another-shop' }} />);

      expect(screen.queryByRole('heading', { name: 'How Long We Keep Your Information' })).not.toBeInTheDocument();
    });

    it('renders without crashing when no merchant prop is provided', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      expect(screen.getByRole('heading', { name: 'How Long We Keep Your Information' })).toBeInTheDocument();

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('renders all five default section headings', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      expect(
        screen.getByRole('heading', { name: 'Information We Collect' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'How We Use Your Information' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Data Security' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Sharing Your Information' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Cookies' }),
      ).toBeInTheDocument();
    });

    it('does not render a SafeHtml node when there is no custom content', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      expect(screen.queryByRole('article', { name: /sanitized content/i })).not.toBeInTheDocument();
    });

    it('mentions the default business name in the intro paragraph', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      expect(screen.getByText('Ogabassey Limited')).toBeInTheDocument();
    });

    it('renders the default email in the contact section', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      for (const link of screen.getAllByRole('link', { name: 'support@ogabassey.com' })) {
        expect(link).toHaveAttribute('href', 'mailto:support@ogabassey.com');
      }
    });

    it('renders the default business_address in the contact section', () => {
      render(<OgabasseyV2PrivacyPolicy />);

      expect(screen.getByText('Lagos, Nigeria')).toBeInTheDocument();
    });
  });

  describe('custom content via merchant.pages.privacy', () => {
    const merchantWithCustomPrivacy = {
      business_name: 'DataSafe Co.',
      email: 'privacy@datasafe.com',
      business_address: 'Tower 3, Eko Atlantic, Lagos',
      pages: {
        privacy: '<p>Our custom privacy policy for DataSafe Co. customers.</p>',
      },
    };

    it('renders the custom privacy content via SafeHtml', () => {
      render(<OgabasseyV2PrivacyPolicy merchant={merchantWithCustomPrivacy} />);

      const safeHtmlNode = screen.getByRole('article', { name: /sanitized content/i });
      expect(safeHtmlNode).toBeInTheDocument();
      expect(safeHtmlNode).toHaveTextContent(
        'Our custom privacy policy for DataSafe Co. customers.',
      );
    });

    it('does not render the default section headings when custom content is set', () => {
      render(<OgabasseyV2PrivacyPolicy merchant={merchantWithCustomPrivacy} />);

      expect(
        screen.queryByRole('heading', { name: 'Information We Collect' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Cookies' }),
      ).not.toBeInTheDocument();
    });

    it('renders merchant email in the contact section', () => {
      render(<OgabasseyV2PrivacyPolicy merchant={merchantWithCustomPrivacy} />);

      expect(
        screen.getByRole('link', { name: 'privacy@datasafe.com' }),
      ).toHaveAttribute('href', 'mailto:privacy@datasafe.com');
    });

    it('renders merchant business_address in the contact section', () => {
      render(<OgabasseyV2PrivacyPolicy merchant={merchantWithCustomPrivacy} />);

      expect(
        screen.getByText('Tower 3, Eko Atlantic, Lagos'),
      ).toBeInTheDocument();
    });

    it('passes the prose className to SafeHtml', () => {
      render(<OgabasseyV2PrivacyPolicy merchant={merchantWithCustomPrivacy} />);

      const safeHtmlNode = screen.getByRole('article', { name: /sanitized content/i });
      expect(safeHtmlNode).toHaveClass('prose');
    });
  });

  describe('edge cases', () => {
    it('renders correctly when merchant has no pages key', () => {
      render(<OgabasseyV2PrivacyPolicy merchant={{ business_name: 'Acme' }} />);

      // Falls back to default sections
      expect(
        screen.getByRole('heading', { name: 'Information We Collect' }),
      ).toBeInTheDocument();
    });

    it('renders correctly when merchant.pages.privacy is an empty string', () => {
      const merchant = { pages: { privacy: '' } };
      render(<OgabasseyV2PrivacyPolicy merchant={merchant} />);

      // Empty string is falsy — should fall through to default sections
      expect(
        screen.getByRole('heading', { name: 'Information We Collect' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('article', { name: /sanitized content/i })).not.toBeInTheDocument();
    });

    it('renders the merchant business name in intro when provided', () => {
      render(
        <OgabasseyV2PrivacyPolicy merchant={{ business_name: 'MyShop' }} />,
      );

      expect(screen.getByText('MyShop')).toBeInTheDocument();
    });
  });
});
