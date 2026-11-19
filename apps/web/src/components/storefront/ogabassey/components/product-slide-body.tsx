import type { LaunchProductSlide } from './LaunchCarousel';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';

/** Split-panel body for a product slide: themed text panel + contained image.
 *  `priority` eager/high-priorities the image when this slide is the topmost
 *  above-fold content (the LCP candidate); otherwise it stays lazy/low. */
export function ProductSlideBody({
  slide,
  priority = false,
}: {
  slide: LaunchProductSlide;
  priority?: boolean;
}) {
  return (
    <div className="grid h-full grid-cols-5 bg-store-background">
      <div className="col-span-3 flex flex-col justify-center gap-1 bg-store-primary px-5 py-4 text-store-on-primary md:col-span-3 md:px-8">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">
          Just launched
        </span>
        <p className="line-clamp-2 text-lg font-bold leading-tight md:text-2xl">
          {slide.name}
        </p>
        <p className="text-sm font-semibold opacity-90 md:text-base">
          {slide.priceLabel}
        </p>
        <span className="mt-2 inline-flex w-fit items-center rounded-full bg-store-on-primary px-4 py-1.5 text-xs font-bold text-store-primary shadow-sm transition-transform active:scale-95 md:text-sm">
          {slide.ctaLabel}
        </span>
      </div>
      <div className="relative col-span-2 bg-store-background">
        <CdnFormatImage
          src={slide.imageUrl}
          alt={slide.imageAlt}
          fill
          // The image occupies the col-span-2 of 5 (~40%) of the carousel,
          // which is up to the 1400px max-width container → ~560px on desktop.
          sizes="(min-width: 1400px) 560px, 40vw"
          className="object-contain p-2"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'low'}
        />
      </div>
    </div>
  );
}
