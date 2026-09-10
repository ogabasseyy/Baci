import { getImageProps } from 'next/image';
import Link from 'next/link';
import { ogabasseyFallbackImageLoader } from '@/lib/ogabassey-image-fallback-loader';
import { buildOgabasseyAvifSrcSet } from '@/lib/ogabassey-image-format-sources';
import { asRoute } from '@/lib/routes';
import { TRANSPARENT_PIXEL_SRC } from './hero-mobile-image-config';
import type { LaunchProductSlide } from './LaunchCarousel';

interface HeroDesktopGridProps {
  /** Launch products, newest-first with pins applied. slides[0] is the big
   *  hero (its image is the eager desktop LCP element); slides[1]/[2] fill the
   *  two side cards. All deep-link to their PDP. */
  slides: LaunchProductSlide[];
}

// Light, neutral card surface (matches the previous hero's restrained palette):
// the merchant primary (`--store-primary`) is used only as an accent — the
// eyebrow label, a thin rule, and the CTA button — never as a large fill.
const CARD_SURFACE = 'bg-store-secondary';

const BIG_IMAGE_WIDTH = 800;
const BIG_IMAGE_HEIGHT = 800;
// Desktop-only so the eager LCP image never downloads on mobile, where this
// whole grid is `display:none` and the mobile carousel owns the LCP slot.
const BIG_IMAGE_SOURCE_MEDIA = '(min-width: 768px)';
const BIG_IMAGE_SIZES = '(min-width: 768px) 480px, 1px';
const SIDE_IMAGE_WIDTH = 320;
const SIDE_IMAGE_HEIGHT = 320;
const SIDE_IMAGE_SOURCE_MEDIA = '(min-width: 768px)';
const SIDE_IMAGE_SIZES = '(min-width: 1024px) 160px, (min-width: 768px) 25vw, 1px';
const HERO_IMAGE_QUALITY = 70;

/** Media-scoped desktop hero image. On mobile no `<source>` matches, so the
 *  `<img>` falls back to a transparent pixel (zero network). Keep fetch
 *  priority low so Chrome does not start the desktop sources as High during
 *  the mobile LCP window. */
function HeroBigImage({ alt, src }: { alt: string; src: string }) {
  const {
    props: { sizes, src: imgSrc, srcSet, ...imgProps },
  } = getImageProps({
    alt,
    decoding: 'async',
    fetchPriority: 'low',
    height: BIG_IMAGE_HEIGHT,
    loader: ogabasseyFallbackImageLoader,
    loading: 'lazy',
    quality: HERO_IMAGE_QUALITY,
    sizes: BIG_IMAGE_SIZES,
    src,
    width: BIG_IMAGE_WIDTH,
  });

  const fallbackSrcSet = srcSet ?? imgSrc;
  // AVIF twin (per-format URL) so AVIF-capable browsers keep AVIF: CF Free
  // ignores `Vary: Accept`, so one `format=auto` body can't serve both tiers.
  // `null` for external images — the plain `<source>` then serves everyone.
  const avifSrcSet = buildOgabasseyAvifSrcSet(fallbackSrcSet);

  return (
    <picture className="absolute inset-0 block h-full w-full">
      {avifSrcSet ? (
        <source
          media={BIG_IMAGE_SOURCE_MEDIA}
          sizes={sizes ?? BIG_IMAGE_SIZES}
          srcSet={avifSrcSet}
          type="image/avif"
        />
      ) : null}
      <source
        media={BIG_IMAGE_SOURCE_MEDIA}
        sizes={sizes ?? BIG_IMAGE_SIZES}
        srcSet={fallbackSrcSet}
      />
      <img
        {...imgProps}
        alt={alt}
        src={TRANSPARENT_PIXEL_SRC}
        className="h-full w-full object-contain p-4 transition-transform duration-700 group-hover:scale-105"
      />
    </picture>
  );
}

/** The large left hero card — a single, static launch product (best for a
 *  stable LCP element). Light surface, brand red used only as an accent. */
function HeroBigCard({
  hasSideCards,
  slide,
}: {
  hasSideCards: boolean;
  slide: LaunchProductSlide;
}) {
  return (
    <Link
      href={asRoute(slide.href)}
      prefetch={false}
      aria-label={`${slide.name} — ${slide.ctaLabel}`}
      className={`group relative ${hasSideCards ? 'lg:col-span-3' : 'lg:col-span-5'} h-[400px] lg:h-full overflow-hidden rounded-2xl ring-1 ring-store-border/70 shadow-lg hover:shadow-xl transition-all duration-300 grid grid-cols-5 ${CARD_SURFACE}`}
    >
      <div className="col-span-3 flex flex-col justify-center gap-3 px-10 lg:px-16 py-8">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-store-primary">
          Just launched
        </span>
        <h2 className="line-clamp-3 text-4xl font-bold leading-tight text-store-secondary-text lg:text-5xl">
          {slide.name}
        </h2>
        <p className="text-xl font-semibold text-store-secondary-text">{slide.priceLabel}</p>
        <div className="mt-1 h-1.5 w-16 rounded-full bg-store-primary" />
        <span className="mt-3 inline-flex w-fit items-center rounded-full bg-store-primary px-7 py-3 text-base font-bold text-store-on-primary shadow-sm transition-all group-hover:scale-105 group-hover:shadow-lg group-active:scale-95">
          {slide.ctaLabel}
        </span>
      </div>
      <div className="relative col-span-2">
        <HeroBigImage alt={slide.imageAlt} src={slide.imageUrl} />
      </div>
    </Link>
  );
}


/** Desktop-only side-card image. The fallback `<img>` is a transparent pixel so
 * hidden desktop cards do not add mobile hero image requests. */
function HeroSideImage({ alt, src }: { alt: string; src: string }) {
  const {
    props: { sizes, src: imgSrc, srcSet, ...imgProps },
  } = getImageProps({
    alt,
    height: SIDE_IMAGE_HEIGHT,
    loader: ogabasseyFallbackImageLoader,
    loading: 'lazy',
    quality: HERO_IMAGE_QUALITY,
    sizes: SIDE_IMAGE_SIZES,
    src,
    width: SIDE_IMAGE_WIDTH,
  });

  const fallbackSrcSet = srcSet ?? imgSrc;
  const avifSrcSet = buildOgabasseyAvifSrcSet(fallbackSrcSet);

  return (
    <picture className="absolute inset-0 block h-full w-full">
      {avifSrcSet ? (
        <source
          media={SIDE_IMAGE_SOURCE_MEDIA}
          sizes={sizes ?? SIDE_IMAGE_SIZES}
          srcSet={avifSrcSet}
          type="image/avif"
        />
      ) : null}
      <source
        media={SIDE_IMAGE_SOURCE_MEDIA}
        sizes={sizes ?? SIDE_IMAGE_SIZES}
        srcSet={fallbackSrcSet}
      />
      <img
        {...imgProps}
        alt={alt}
        src={TRANSPARENT_PIXEL_SRC}
        className="h-full w-full object-contain p-2 transition-transform duration-700 group-hover:scale-105"
      />
    </picture>
  );
}

/** A compact side card backed by a launch product. Image is lazy (not LCP). */
function HeroSideCard({ slide }: { slide: LaunchProductSlide }) {
  return (
    <Link
      href={asRoute(slide.href)}
      prefetch={false}
      aria-label={`${slide.name} — ${slide.ctaLabel}`}
      className={`group relative grid flex-1 grid-cols-5 overflow-hidden rounded-2xl shadow-lg ring-1 ring-store-border/70 transition-all duration-300 hover:shadow-xl ${CARD_SURFACE}`}
    >
      <div className="col-span-3 flex flex-col justify-center gap-1.5 px-5 py-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-store-primary">
          Just launched
        </span>
        <h3 className="line-clamp-2 text-lg font-bold leading-tight text-store-secondary-text">
          {slide.name}
        </h3>
        <p className="text-sm font-semibold text-store-secondary-text">{slide.priceLabel}</p>
        <span className="mt-1 text-xs font-bold text-store-primary underline underline-offset-2">
          {slide.ctaLabel}
        </span>
      </div>
      <div className="relative col-span-2">
        <HeroSideImage alt={slide.imageAlt} src={slide.imageUrl} />
      </div>
    </Link>
  );
}

export function HeroDesktopGrid({ slides }: HeroDesktopGridProps) {
  const [big, ...rest] = slides;
  const sideCards = rest.slice(0, 2);

  if (!big) {
    return null;
  }

  return (
    <div
      className="hidden md:grid grid-cols-1 lg:grid-cols-5 gap-4 h-auto lg:h-[540px] order-2"
      aria-label="Featured products"
      data-ogabassey-desktop-hero="true"
      role="region"
    >
      <HeroBigCard hasSideCards={sideCards.length > 0} slide={big} />

      {sideCards.length > 0 ? (
        <div className="flex flex-col gap-4 h-full lg:col-span-2">
          {sideCards.map((slide) => (
            <HeroSideCard key={slide.id} slide={slide} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
