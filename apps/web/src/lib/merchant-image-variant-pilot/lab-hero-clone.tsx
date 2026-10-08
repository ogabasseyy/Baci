// biome-ignore-all lint/a11y/useSemanticElements: verbatim production carousel shell — role=region/group are the original hero-mobile-carousel.tsx announced semantics and the lab must not redesign them. (The original file is config-ignored wholesale.)
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CarouselPlayToggle } from '@/components/storefront/ogabassey/components/carousel-play-toggle';
import { CarouselProgressFill } from '@/components/storefront/ogabassey/components/carousel-progress-fill';
import { HeroMobileControlsSkeleton } from '@/components/storefront/ogabassey/components/hero-mobile-controls-skeleton';
import {
  HERO_MOBILE_CONTROL_TRACK_CLASSES,
  HERO_MOBILE_CONTROLS_ROW_CLASSES,
  HERO_MOBILE_CTA_CLASSES,
  HERO_MOBILE_EYEBROW_CLASSES,
  HERO_MOBILE_IMAGE_COLUMN_CLASSES,
  HERO_MOBILE_PANEL_CLASSES,
  HERO_MOBILE_PLAY_TOGGLE_SLOT_CLASSES,
  HERO_MOBILE_PRICE_CLASSES,
  HERO_MOBILE_SLIDE_GRID_CLASSES,
  HERO_MOBILE_TEXT_COLUMN_CLASSES,
  HERO_MOBILE_TITLE_CLASSES,
  HERO_MOBILE_WRAPPER_CLASSES,
} from '@/components/storefront/ogabassey/components/hero-mobile-geometry';
import {
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_IMAGE_SIZES,
  TRANSPARENT_PIXEL_SRC,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import type { LaunchProductSlide } from '@/components/storefront/ogabassey/components/LaunchCarousel';
import { useHeroSwipe } from '@/components/storefront/ogabassey/components/use-hero-swipe';
import { asRoute } from '@/lib/routes';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

// Lab-only clone of HeroMobileCarousel
// (src/components/storefront/ogabassey/components/hero-mobile-carousel.tsx)
// with ONLY the slide-0 image element changed: <MobileLcpHeroImage> is
// replaced by the projected <picture> (explicit staged srcSets). All shell
// JSX — panel, slides, text column, dots, play toggle, swipe/focus/rotation
// state — is verbatim, reusing the production geometry tokens and
// subcomponents. Non-current slides keep the verbatim lazy next/image. The
// control arm renders the ORIGINAL HeroMobileCarousel with the staged
// original URL; this clone renders the pilot arm. See lab-hero-clone.test.tsx
// for the structural parity proof (clone-control vs original).

export function LabHeroSlideImage({
  projection,
}: {
  projection: ProjectedOgabasseyMobile;
}) {
  return (
    <picture className="block h-full w-full" data-pilot-lab-hero-slide="0">
      <source
        media={projection.media}
        sizes={projection.sizes}
        srcSet={projection.avifSrcSet}
        type="image/avif"
      />
      <source
        media={projection.media}
        sizes={projection.sizes}
        srcSet={projection.fallbackSrcSet}
      />
      <img
        alt={projection.alt}
        decoding="sync"
        fetchPriority="high"
        loading="eager"
        src={projection.imgSrc}
        className={`h-full w-full ${
          projection.imageFit === 'contain'
            ? 'object-contain object-right'
            : 'object-cover'
        }`}
      />
    </picture>
  );
}

const AUTO_ADVANCE_MS = 5000;

interface LabHeroMobileCarouselProps {
  slides: LaunchProductSlide[];
  prioritizeFirstImage?: boolean;
  slide0Projection: ProjectedOgabasseyMobile;
}

export function LabHeroMobileCarousel({
  prioritizeFirstImage = true,
  slides,
  slide0Projection,
}: LabHeroMobileCarouselProps) {
  const slideCount = slides.length;
  const hasMultipleSlides = slideCount > 1;
  const [currentSlide, setCurrentSlide] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(true);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(query.matches);
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (currentSlide > slideCount - 1) {
      setCurrentSlide(0);
    }
  }, [currentSlide, slideCount]);

  const fillAnimates = hasMultipleSlides && !prefersReducedMotion;
  const rotationEnabled = fillAnimates && !userPaused;
  const autoAdvances = rotationEnabled && !isPaused && !isFocusWithin;

  // biome-ignore lint/correctness/useExhaustiveDependencies: verbatim production re-arm semantics — currentSlide/cycle intentionally re-arm a full countdown.
  useEffect(() => {
    if (!autoAdvances) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCurrentSlide((index) => (index + 1) % slideCount);
      setCycle((value) => value + 1);
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
    // `cycle` is a dependency so a manual restart re-arms a full countdown.
  }, [autoAdvances, currentSlide, cycle, slideCount]);

  const goToSlide = (index: number) => {
    setCurrentSlide(((index % slideCount) + slideCount) % slideCount);
    setCycle((value) => value + 1);
  };

  const {
    handleClickCapture,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchStart,
  } = useHeroSwipe({
    hasMultipleSlides,
    onPausedChange: setIsPaused,
    onRearm: () => setCycle((value) => value + 1),
    onSwipe: (direction) => goToSlide(currentSlide + direction),
  });

  if (slideCount === 0) {
    return null;
  }

  return (
    <div
      className={HERO_MOBILE_WRAPPER_CLASSES}
      data-ogabassey-mobile-hero="true"
    >
      <div
        aria-label="Featured launch product carousel"
        aria-roledescription="carousel"
        className={HERO_MOBILE_PANEL_CLASSES}
        data-ogabassey-mobile-hero-panel="true"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsFocusWithin(false);
            setCycle((value) => value + 1);
          }
        }}
        onClickCapture={handleClickCapture}
        onFocus={() => setIsFocusWithin(true)}
        onTouchCancel={handleTouchCancel}
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
        role="region"
      >
        {slides.map((slide, index) => {
          const isCurrent = index === currentSlide;
          const isPrioritizedMobileImage = index === 0 && prioritizeFirstImage;
          const shouldRenderImage = isCurrent || isPrioritizedMobileImage;

          return (
            <div
              key={slide.id}
              aria-hidden={!isCurrent}
              aria-label={`${index + 1} of ${slideCount}`}
              aria-roledescription="slide"
              className={`${HERO_MOBILE_SLIDE_GRID_CLASSES} transition-opacity [transition-duration:400ms] ease-in-out ${isCurrent ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
              inert={!isCurrent}
              role="group"
            >
              <div className={HERO_MOBILE_TEXT_COLUMN_CLASSES}>
                <span className={HERO_MOBILE_EYEBROW_CLASSES}>
                  Just launched
                </span>
                <h2 className={HERO_MOBILE_TITLE_CLASSES}>{slide.name}</h2>
                <p className={HERO_MOBILE_PRICE_CLASSES}>{slide.priceLabel}</p>
                <span className={HERO_MOBILE_CTA_CLASSES}>
                  {slide.ctaLabel}
                </span>
              </div>
              <div className={HERO_MOBILE_IMAGE_COLUMN_CLASSES}>
                {isPrioritizedMobileImage ? (
                  <LabHeroSlideImage projection={slide0Projection} />
                ) : shouldRenderImage ? (
                  <Image
                    alt={slide.imageAlt}
                    className="object-contain p-2"
                    fill
                    loading="lazy"
                    quality={MOBILE_HERO_IMAGE_QUALITY}
                    sizes={MOBILE_HERO_IMAGE_SIZES}
                    src={slide.imageUrl}
                  />
                ) : null}
              </div>
              <Link
                aria-label={`${slide.name} — ${slide.ctaLabel}`}
                className="absolute inset-0"
                href={asRoute(slide.href)}
                prefetch={false}
              >
                <span className="sr-only">{`${slide.name} — ${slide.ctaLabel}`}</span>
              </Link>
            </div>
          );
        })}
      </div>

      {hasMultipleSlides ? (
        <div className={HERO_MOBILE_CONTROLS_ROW_CLASSES}>
          <div
            aria-label="Hero carousel slide controls"
            className="flex flex-1 items-center gap-1.5"
            role="group"
          >
            {slides.map((slide, idx) => {
              const isActive = currentSlide === idx;
              const isPast = idx < currentSlide;

              return (
                <button
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={`Go to hero slide ${idx + 1}`}
                  className={`group relative cursor-pointer ${HERO_MOBILE_CONTROL_TRACK_CLASSES}`}
                  key={slide.id}
                  onClick={() => goToSlide(idx)}
                  type="button"
                >
                  <span className="absolute inset-x-0 top-1/2 block h-1 -translate-y-1/2 overflow-hidden rounded-full bg-store-primary/20">
                    {isActive ? (
                      <CarouselProgressFill
                        animate={rotationEnabled}
                        cycleKey={cycle}
                        durationMs={AUTO_ADVANCE_MS}
                        isPaused={isPaused || userPaused || isFocusWithin}
                      />
                    ) : (
                      <span
                        className={`block h-full origin-left rounded-full bg-store-primary transition-transform duration-300 ${isPast ? 'scale-x-100' : 'scale-x-0'}`}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {!prefersReducedMotion ? (
            <CarouselPlayToggle
              className="bg-store-primary shadow-sm"
              isPlaying={!userPaused}
              onToggle={() => {
                if (userPaused) {
                  setCycle((value) => value + 1);
                }
                setUserPaused((value) => !value);
              }}
            />
          ) : (
            <div
              aria-hidden="true"
              className={`${HERO_MOBILE_PLAY_TOGGLE_SLOT_CLASSES} invisible`}
              data-ogabassey-carousel-toggle-slot="reserved"
            />
          )}
        </div>
      ) : (
        <HeroMobileControlsSkeleton invisible />
      )}
    </div>
  );
}

export { labHeroSlides, labHeroSlot } from './lab-fixtures';

export { TRANSPARENT_PIXEL_SRC };
