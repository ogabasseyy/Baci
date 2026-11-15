import {
  ArrowDown,
  ArrowUpRight,
  Headphones,
  Laptop,
  Leaf,
  Smartphone,
  Tablet,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { asRoute } from '@/lib/routes';
import { HeroBigImage } from '../components/hero-desktop-grid';
import type { LaunchProductSlide } from '../components/LaunchCarousel';
import { MobileLcpHeroImage } from '../components/mobile-lcp-hero-image';
import { AccessBenefits } from './access-benefits';
import { AccessHeroSearch } from './access-hero-search';
import { AccessStyles } from './access-styles';

interface AccessHomeHeroProps {
  slides: LaunchProductSlide[];
  basePath?: string;
  omitDocumentHeading?: boolean;
  omitMobileCarousel?: boolean;
  prioritizeMobileHeroImage?: boolean;
  reserve?: boolean;
  searchPlacement?: 'above-description' | 'below-description';
}

/** Server-rendered, with no carousel hydration, animation or extra data fetch.
 * The same markup is used invisibly for the publication-safe stream reserve. */
export function Hero({
  slides,
  basePath = '',
  omitDocumentHeading = false,
  omitMobileCarousel = false,
  prioritizeMobileHeroImage = true,
  reserve = false,
  searchPlacement = 'below-description',
}: AccessHomeHeroProps) {
  const slide = reserve ? undefined : slides[0];
  const Heading = omitDocumentHeading ? 'h2' : 'h1';
  const href = (path: string) => asRoute(`${basePath}${path}`);
  const action = (path: string, className: string, children: ReactNode) =>
    reserve ? (
      <span className={className}>{children}</span>
    ) : (
      <Link href={href(path)} prefetch={false} className={className}>
        {children}
      </Link>
    );
  return (
    <div
      className={`oga-access${reserve ? ' oa-reserve' : ''}${omitMobileCarousel ? ' oa-hide-mobile' : ''}`}
      aria-hidden={reserve || undefined}
      inert={reserve || undefined}
      data-ogabassey-access-hero="true"
      data-search-placement={searchPlacement}
    >
      <AccessStyles />
      <div className="oa-wrap">
        <section className="oa-hero" aria-label="Technology within reach">
          <div className="oa-intro">
            <span className="oa-kicker">Your next big thing starts here</span>
            <Heading>
              Big dreams.
              <br />
              <em>Small price tags.</em>
            </Heading>
            {searchPlacement === 'above-description' && (
              <AccessHeroSearch basePath={basePath} reserve={reserve} />
            )}
            <p className="oa-hero-description">
              Smartphones, laptops & gadgets for everything you want to become
              <br />
              Learn, create, earn. Your way.
            </p>
            {searchPlacement === 'below-description' && (
              <AccessHeroSearch basePath={basePath} reserve={reserve} />
            )}
            <div className="oa-actions">
              {action(
                '/products',
                searchPlacement ? 'oa-textlink' : 'oa-button',
                <>
                  Find your device <ArrowUpRight size={17} aria-hidden="true" />
                </>
              )}
              {action(
                '#ways-to-own',
                'oa-textlink',
                <>
                  Explore ways to pay <ArrowDown size={14} aria-hidden="true" />
                </>
              )}
            </div>
            <div className="oa-note">
              <Leaf size={14} aria-hidden="true" /> Good for your pocket. Kinder
              to the planet.
            </div>
          </div>
          <div className="oa-scene">
            <div className="oa-dream-card" aria-hidden="true">
              <span className="oa-handwritten">
                Made for your next chapter.
              </span>
              <div className="oa-laptop-art">
                <span className="oa-window-dots">•••</span>
                <strong>
                  Learn.
                  <br />
                  Create.
                  <br />
                  <em>Earn.</em>
                </strong>
                <span className="oa-cursor">↗</span>
              </div>
              <div className="oa-laptop-base" />
              <span className="oa-scene-caption">
                Big ideas deserve good tech.
              </span>
            </div>
            <div className="oa-showcase">
              <div className="oa-showcase-top">
                <span>Your next possibility</span>
                <span className="oa-index">OG / 01</span>
              </div>
              <div className="oa-product-art">
                {slide ? (
                  <>
                    <div className="oa-mobile-art">
                      <MobileLcpHeroImage
                        alt={slide.imageAlt}
                        src={slide.imageUrl}
                        imageFit="contain"
                        shouldPrioritizeImage={prioritizeMobileHeroImage}
                      />
                    </div>
                    <div className="oa-desktop-art">
                      <HeroBigImage alt={slide.imageAlt} src={slide.imageUrl} />
                    </div>
                  </>
                ) : (
                  <span className="oa-empty-art" aria-hidden="true">
                    hello.
                  </span>
                )}
              </div>
              <div className="oa-product-bottom">
                <div>
                  <h3>{slide?.name ?? 'Find your next possibility'}</h3>
                  <p>{slide?.priceLabel ?? 'Smartphones, laptops & more'}</p>
                </div>
                {slide ? (
                  <Link
                    className="oa-circle"
                    href={asRoute(slide.href)}
                    prefetch={false}
                    aria-label={`${slide.name} — ${slide.ctaLabel}`}
                  >
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="oa-circle">
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </span>
                )}
              </div>
            </div>
            <div className="oa-possibility-card" aria-hidden="true">
              <span className="oa-sunburst">
                GOOD
                <br />
                TECH.
                <br />
                GREAT
                <br />
                VALUE.
              </span>
              <div className="oa-reuse-sticker">
                <Leaf size={26} />
                <span>
                  A second life.
                  <br />A fresh start.
                </span>
              </div>
            </div>
          </div>
        </section>
        <AccessBenefits />
        <nav className="oa-categories" aria-label="Shop device categories">
          {[
            { label: 'Smartphones', path: '/smartphones', Icon: Smartphone },
            { label: 'Laptops', path: '/laptops', Icon: Laptop },
            { label: 'Tablets', path: '/tablets', Icon: Tablet },
            {
              label: 'Audio & accessories',
              path: '/accessories',
              Icon: Headphones,
            },
          ].map(({ label, path, Icon }) => (
            <div key={path}>
              {action(
                path,
                'oa-category',
                <>
                  <span>
                    <Icon size={22} aria-hidden="true" />
                    {label}
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </>
              )}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
