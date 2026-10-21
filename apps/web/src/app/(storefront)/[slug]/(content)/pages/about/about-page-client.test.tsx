import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MerchantAboutPage } from '@/types/about-page';
import { AboutPageClient } from './about-page-client';

// ---------------------------------------------------------------------------
// Module mocks — hoisted by Vitest automatically
// ---------------------------------------------------------------------------

vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: ({ html, className }: { html: string; className?: string }) => (
    <div data-testid="safe-html" className={className}>
      {html}
    </div>
  ),
}));

// Heavy infrastructure — stub to avoid deep provider setup
vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/contexts/storefront-context', () => ({
  StorefrontProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/app-body', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-body">{children}</div>
  ),
}));

vi.mock('@/components/storefront/header', () => ({
  StorefrontHeader: () => <header data-testid="storefront-header" />,
}));

vi.mock('@/components/storefront/footer', () => ({
  StorefrontFooter: () => <footer data-testid="storefront-footer" />,
}));

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    className?: string;
  }) => (
    // biome-ignore lint/performance/noImgElement: test stub only
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
    />
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseMerchant = {
  id: 'merchant-1',
  slug: 'test-store',
  business_name: 'Test Store',
};

const emptyAboutPage: MerchantAboutPage = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AboutPageClient', () => {
  describe('page structure', () => {
    it('renders the header and footer', () => {
      render(
        <AboutPageClient merchant={baseMerchant} aboutPage={emptyAboutPage} />
      );

      expect(screen.getByTestId('storefront-header')).toBeInTheDocument();
      expect(screen.getByTestId('storefront-footer')).toBeInTheDocument();
    });

    it('renders the hero heading with the merchant business name', () => {
      render(
        <AboutPageClient merchant={baseMerchant} aboutPage={emptyAboutPage} />
      );

      expect(
        screen.getByRole('heading', { level: 1, name: /About Test Store/i })
      ).toBeInTheDocument();
    });

    it('renders crawl summary children before the storefront footer', () => {
      render(
        <AboutPageClient merchant={baseMerchant} aboutPage={emptyAboutPage}>
          <section data-testid="crawl-summary">SEO crawl summary</section>
        </AboutPageClient>
      );

      const summary = screen.getByTestId('crawl-summary');
      const footer = screen.getByTestId('storefront-footer');

      expect(
        summary.compareDocumentPosition(footer) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('renders mission statement in the hero section when provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'Empowering African merchants worldwide.',
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByText('Empowering African merchants worldwide.')
      ).toBeInTheDocument();
    });

    it('does not render a mission paragraph when mission is absent', () => {
      render(
        <AboutPageClient merchant={baseMerchant} aboutPage={emptyAboutPage} />
      );

      expect(
        screen.queryByText(/Empowering African merchants/i)
      ).not.toBeInTheDocument();
    });
  });

  describe('story section', () => {
    it('renders the Our Story heading and SafeHtml when story is provided', () => {
      const aboutPage: MerchantAboutPage = {
        story: '<p>We started in a small Lagos shop.</p>',
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: /Our Story/i })
      ).toBeInTheDocument();

      const safeHtml = screen.getByTestId('safe-html');
      expect(safeHtml).toHaveTextContent('We started in a small Lagos shop.');
    });

    it('does not render the Our Story section when story is absent', () => {
      render(
        <AboutPageClient merchant={baseMerchant} aboutPage={emptyAboutPage} />
      );

      expect(
        screen.queryByRole('heading', { name: /Our Story/i })
      ).not.toBeInTheDocument();
    });

    it('passes the prose className to SafeHtml for the story', () => {
      const aboutPage: MerchantAboutPage = {
        story: '<p>Founded in 2010.</p>',
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(screen.getByTestId('safe-html')).toHaveClass(
        'prose',
        'prose-lg',
        'dark:prose-invert'
      );
    });
  });

  describe('legacy content fallback', () => {
    it('renders legacy HTML content via SafeHtml when no structured content exists', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={emptyAboutPage}
          legacyContent="<p>Old about page content.</p>"
        />
      );

      const safeHtml = screen.getByTestId('safe-html');
      expect(safeHtml).toHaveTextContent('Old about page content.');
    });

    it('does not render legacy content when structured content is present', () => {
      const aboutPage: MerchantAboutPage = {
        story: '<p>New structured story.</p>',
      };

      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={aboutPage}
          legacyContent="<p>Old legacy content that should be hidden.</p>"
        />
      );

      // The structured story SafeHtml is rendered; legacy text should NOT appear
      expect(
        screen.queryByText(/Old legacy content that should be hidden/i)
      ).not.toBeInTheDocument();
    });

    it('renders nothing in the content area when neither structured content nor legacy content exist', () => {
      render(
        <AboutPageClient merchant={baseMerchant} aboutPage={emptyAboutPage} />
      );

      expect(screen.queryByTestId('safe-html')).not.toBeInTheDocument();
    });
  });

  describe('vision and values section', () => {
    it('renders vision card when vision is provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        vision: 'To be the top e-commerce platform in Africa.',
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: /Our Vision/i })
      ).toBeInTheDocument();
      expect(
        screen.getByText('To be the top e-commerce platform in Africa.')
      ).toBeInTheDocument();
    });

    it('renders values list when values are provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        values: ['Integrity', 'Innovation', 'Excellence'],
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: /Our Values/i })
      ).toBeInTheDocument();
      expect(screen.getByText('Integrity')).toBeInTheDocument();
      expect(screen.getByText('Innovation')).toBeInTheDocument();
      expect(screen.getByText('Excellence')).toBeInTheDocument();
    });

    it('does not render the vision/values section when both are absent', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'Mission only' }}
        />
      );

      expect(
        screen.queryByRole('heading', { name: /Our Vision/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: /Our Values/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('team section', () => {
    it('renders the Our Team heading and each member when team is provided', () => {
      const aboutPage: MerchantAboutPage = {
        team: [
          { name: 'Ada Okafor', role: 'CEO', bio: 'Visionary leader.' },
          { name: 'Emeka Nwosu', role: 'CTO', bio: 'Tech wizard.' },
        ],
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: 'Our Team' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Ada Okafor' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Emeka Nwosu' })
      ).toBeInTheDocument();
      expect(screen.getByText('CEO')).toBeInTheDocument();
      expect(screen.getByText('CTO')).toBeInTheDocument();
      expect(screen.getByText('Visionary leader.')).toBeInTheDocument();
      expect(screen.getByText('Tech wizard.')).toBeInTheDocument();
    });

    it('renders member images when image URL is provided', () => {
      const aboutPage: MerchantAboutPage = {
        team: [
          {
            name: 'Funke Bello',
            role: 'Designer',
            image: 'https://example.com/funke.jpg',
          },
        ],
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      const img = screen.getByAltText('Funke Bello');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/funke.jpg');
    });

    it('renders member LinkedIn link when social_links.linkedin is provided', () => {
      const aboutPage: MerchantAboutPage = {
        team: [
          {
            name: 'Tunde Ojo',
            role: 'Engineer',
            social_links: {
              linkedin: 'https://linkedin.com/in/tundeojo',
            },
          },
        ],
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'https://linkedin.com/in/tundeojo');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('does not render the Our Team section when team array is empty', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'A mission', team: [] }}
        />
      );

      expect(
        screen.queryByRole('heading', { name: 'Our Team' })
      ).not.toBeInTheDocument();
    });

    it('does not render the Our Team section when team is absent', () => {
      render(
        <AboutPageClient merchant={baseMerchant} aboutPage={emptyAboutPage} />
      );

      expect(
        screen.queryByRole('heading', { name: 'Our Team' })
      ).not.toBeInTheDocument();
    });
  });

  describe('founder section', () => {
    it('renders the founder name and bio when provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        founder_name: 'Chioma Eze',
        founder_bio: 'Serial entrepreneur from Enugu.',
        founded_year: 2018,
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: /Meet the Founder/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Chioma Eze' })
      ).toBeInTheDocument();
      expect(
        screen.getByText('Serial entrepreneur from Enugu.')
      ).toBeInTheDocument();
      expect(screen.getByText(/Founded in 2018/i)).toBeInTheDocument();
    });

    it('renders founder image when founder_image is provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        founder_name: 'Kemi Adeyemi',
        founder_image: 'https://example.com/kemi.jpg',
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      const img = screen.getByAltText('Kemi Adeyemi');
      expect(img).toHaveAttribute('src', 'https://example.com/kemi.jpg');
    });

    it('does not render the founder section when founder_name is absent', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'A mission' }}
        />
      );

      expect(
        screen.queryByRole('heading', { name: /Meet the Founder/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('social proof stats section', () => {
    it('renders years in business when provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        social_proof: { years_in_business: 7 },
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(screen.getByText('7+')).toBeInTheDocument();
      expect(screen.getByText('Years in Business')).toBeInTheDocument();
    });

    it('renders formatted customers served count', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        social_proof: { customers_served: 15000 },
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(screen.getByText(/15,000\+/)).toBeInTheDocument();
      expect(screen.getByText('Happy Customers')).toBeInTheDocument();
    });

    it('renders rating and review count when both are provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        social_proof: { rating: 4.8, review_count: 320 },
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(screen.getByText(/4\.8/)).toBeInTheDocument();
      expect(screen.getByText('320 Reviews')).toBeInTheDocument();
    });

    it('does not render the stats section when social_proof is absent', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'A mission' }}
        />
      );

      expect(screen.queryByText('Years in Business')).not.toBeInTheDocument();
      expect(screen.queryByText('Happy Customers')).not.toBeInTheDocument();
    });
  });

  describe('milestones section', () => {
    it('renders Our Journey heading and each milestone', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        milestones: [
          { year: 2015, title: 'Company Founded', description: 'Day one.' },
          { year: 2020, title: 'First 10,000 customers' },
        ],
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: /Our Journey/i })
      ).toBeInTheDocument();
      expect(screen.getByText('Company Founded')).toBeInTheDocument();
      expect(screen.getByText('Day one.')).toBeInTheDocument();
      expect(screen.getByText('First 10,000 customers')).toBeInTheDocument();
    });

    it('does not render the milestones section when array is empty', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'A mission', milestones: [] }}
        />
      );

      expect(
        screen.queryByRole('heading', { name: /Our Journey/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('awards section', () => {
    it('renders Awards & Recognition heading and each award', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        awards: [
          { title: 'Best SME 2022', issuer: 'Lagos Chamber', year: 2022 },
          { title: 'Innovation Award' },
        ],
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: /Awards & Recognition/i })
      ).toBeInTheDocument();
      expect(screen.getByText('Best SME 2022')).toBeInTheDocument();
      expect(screen.getByText('Lagos Chamber')).toBeInTheDocument();
      expect(screen.getByText('2022')).toBeInTheDocument();
      expect(screen.getByText('Innovation Award')).toBeInTheDocument();
    });

    it('does not render the awards section when array is empty', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'A mission', awards: [] }}
        />
      );

      expect(
        screen.queryByRole('heading', { name: /Awards & Recognition/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('video section', () => {
    it('renders the Watch Our Story section with an iframe when video_url is provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: /Watch Our Story/i })
      ).toBeInTheDocument();

      const iframe = screen.getByTitle('About Us Video');
      expect(iframe).toBeInTheDocument();
      // YouTube watch?v= → embed/ transformation
      expect(iframe).toHaveAttribute(
        'src',
        expect.stringContaining('embed/dQw4w9WgXcQ')
      );
      expect(iframe).toHaveAttribute(
        'sandbox',
        'allow-same-origin allow-scripts allow-presentation allow-popups allow-popups-to-escape-sandbox'
      );
    });

    it('does not render the video section when video_url is absent', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'A mission' }}
        />
      );

      expect(
        screen.queryByRole('heading', { name: /Watch Our Story/i })
      ).not.toBeInTheDocument();
      expect(screen.queryByTitle('About Us Video')).not.toBeInTheDocument();
    });
  });

  describe('gallery section', () => {
    it('renders the Gallery heading and all images when gallery is provided', () => {
      const aboutPage: MerchantAboutPage = {
        mission: 'A mission',
        gallery: [
          'https://example.com/photo1.jpg',
          'https://example.com/photo2.jpg',
        ],
      };

      render(<AboutPageClient merchant={baseMerchant} aboutPage={aboutPage} />);

      expect(
        screen.getByRole('heading', { name: 'Gallery' })
      ).toBeInTheDocument();

      const galleryImages = screen
        .getAllByRole('img')
        .filter((img) => img.getAttribute('alt') === 'Gallery image');
      expect(galleryImages).toHaveLength(2);
    });

    it('does not render the gallery section when array is empty', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'A mission', gallery: [] }}
        />
      );

      expect(
        screen.queryByRole('heading', { name: 'Gallery' })
      ).not.toBeInTheDocument();
    });
  });

  describe('hasStructuredContent detection', () => {
    it('treats mission-only as structured content and does not show legacy fallback', () => {
      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={{ mission: 'We care about you.' }}
          legacyContent="<p>Legacy fallback.</p>"
        />
      );

      // Mission is shown in hero, not via SafeHtml
      expect(screen.getByText('We care about you.')).toBeInTheDocument();
      // Legacy content must NOT appear
      expect(screen.queryByText(/Legacy fallback/i)).not.toBeInTheDocument();
    });

    it('treats team with one member as structured content', () => {
      const aboutPage: MerchantAboutPage = {
        team: [{ name: 'Solo Member', role: 'Founder' }],
      };

      render(
        <AboutPageClient
          merchant={baseMerchant}
          aboutPage={aboutPage}
          legacyContent="<p>Should not appear.</p>"
        />
      );

      expect(
        screen.getByRole('heading', { name: 'Our Team' })
      ).toBeInTheDocument();
      expect(screen.queryByText(/Should not appear/i)).not.toBeInTheDocument();
    });
  });

  describe('merchant branding', () => {
    it('renders correctly when optional merchant fields are absent', () => {
      const minimalMerchant = {
        id: 'minimal-1',
        slug: 'minimal-store',
        business_name: 'Minimal Store',
      };

      render(
        <AboutPageClient
          merchant={minimalMerchant}
          aboutPage={{ mission: 'A clean mission.' }}
        />
      );

      expect(
        screen.getByRole('heading', { level: 1, name: /About Minimal Store/i })
      ).toBeInTheDocument();
    });

    it('renders correctly with full merchant branding including brand_colors', () => {
      const brandedMerchant = {
        id: 'branded-1',
        slug: 'branded-store',
        business_name: 'Branded Store',
        logo_url: 'https://example.com/logo.png',
        brand_colors: {
          primary: '#E63946',
          secondary: '#457B9D',
          accent: '#F1FAEE',
          background: '#FFFFFF',
        },
      };

      render(
        <AboutPageClient
          merchant={brandedMerchant}
          aboutPage={{ mission: 'Branded mission.' }}
        />
      );

      expect(
        screen.getByRole('heading', { level: 1, name: /About Branded Store/i })
      ).toBeInTheDocument();
    });
  });
});
