import type { ReactNode } from 'react';
import { ThemedButton } from '@/components/themed/themed-button';
import { PreviewInertFAQ } from './preview-inert-faq';
import { PreviewInertFooter } from './preview-inert-footer';
import { PreviewInertHeader } from './preview-inert-header';
import {
  PreviewInertHero,
  type PreviewInertHeroProps,
} from './preview-inert-hero';

type PreviewCarouselProps = {
  slides?: PreviewInertHeroProps[];
};

type PreviewFlexProps = {
  puck?: {
    renderDropZone?: (props: { zone: string }) => ReactNode;
  };
};

type PreviewButtonProps = {
  align?: PreviewButtonAlign;
  link?: string;
  size?: PreviewButtonSize;
  text?: string;
  variant?: PreviewButtonVariant;
};

type PreviewButtonAlign = 'left' | 'center' | 'right';

type PreviewButtonSize = 'sm' | 'default' | 'lg';

type PreviewButtonVariant = 'primary' | 'background' | 'accent';

type PreviewPlaceholderProps = {
  label?: string;
};

const previewButtonAlignClasses: Record<PreviewButtonAlign, string> = {
  center: 'justify-center',
  left: 'justify-start',
  right: 'justify-end',
};

const previewButtonSizeClasses: Record<PreviewButtonSize, string> = {
  default: 'h-9 px-4 py-2 text-sm',
  lg: 'h-10 px-6 py-3 text-base',
  sm: 'h-8 px-3 text-sm',
};

function InertAction({
  children,
  className,
  colorRole,
  size,
}: {
  children: ReactNode;
  className?: string;
  colorRole?: PreviewButtonVariant;
  size?: PreviewButtonSize;
}) {
  return (
    <ThemedButton
      aria-disabled="true"
      className={className}
      colorRole={colorRole}
      disabled
      size={size}
      type="button"
    >
      {children}
    </ThemedButton>
  );
}

function PreviewHeroCarousel({ slides = [] }: PreviewCarouselProps) {
  const activeIndex = slides.length > 0 ? 0 : -1;
  const activeSlide = activeIndex >= 0 ? slides[activeIndex] : undefined;

  return (
    <>
      <section
        aria-label="Preview hero carousel"
        className="relative h-[60vh] w-full overflow-hidden"
        data-slide-count={slides.length}
        data-active-slide-index={activeIndex}
      >
        {activeSlide ? (
          <article
            className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center text-store-primary-text"
            data-slide-index={activeIndex}
            key={`${activeIndex}:${activeSlide.title ?? ''}:${activeSlide.subtitle ?? ''}:${activeSlide.ctaText ?? ''}`}
            style={
              activeSlide.image
                ? {
                    backgroundImage: `url(${activeSlide.image})`,
                    backgroundPosition: 'center',
                    backgroundSize: 'cover',
                  }
                : undefined
            }
          >
            {activeSlide.image ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-linear-to-t from-store-foreground/90 via-store-foreground/40 to-transparent"
              />
            ) : null}
            <div className="relative z-10">
              <h2>{activeSlide.title}</h2>
              {activeSlide.subtitle ? <p>{activeSlide.subtitle}</p> : null}
              {activeSlide.ctaText ? (
                <InertAction size="lg">{activeSlide.ctaText}</InertAction>
              ) : null}
              {activeSlide.ctaLink ? (
                <output
                  aria-label={`Preview carousel slide ${activeIndex + 1} CTA destination`}
                  className="block max-w-full truncate text-xs opacity-80"
                  title={activeSlide.ctaLink}
                >
                  {activeSlide.ctaLink}
                </output>
              ) : null}
            </div>
          </article>
        ) : null}
      </section>
      {slides.length > 1 ? (
        <details
          className="border-t border-store-border px-4 py-3 text-sm"
          data-testid="builder-preview-carousel-slides"
          open
        >
          <summary>Review {slides.length} slides</summary>
          <ol className="mt-3 space-y-3">
            {slides.slice(1).map((slide, index) => (
              <li key={`${slide.title ?? ''}:${slide.ctaText ?? ''}`}>
                <h3>{slide.title}</h3>
                {slide.subtitle ? <p>{slide.subtitle}</p> : null}
                {slide.ctaText ? <p>{slide.ctaText}</p> : null}
                {slide.ctaLink ? (
                  <output
                    aria-label={`Preview carousel slide ${index + 2} CTA destination`}
                    className="block max-w-full truncate text-xs opacity-80"
                    title={slide.ctaLink}
                  >
                    {slide.ctaLink}
                  </output>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}

function PreviewFlex({ puck }: PreviewFlexProps) {
  return (
    <section className="flex flex-col" data-testid="builder-preview-inert-flex">
      {puck?.renderDropZone?.({ zone: 'children' }) ?? null}
    </section>
  );
}

function PreviewButton({
  align = 'center',
  link,
  size = 'default',
  text,
  variant = 'primary',
}: PreviewButtonProps) {
  return (
    <div
      className={`container flex px-4 py-4 md:px-6 ${previewButtonAlignClasses[align]}`}
      data-align={align}
      data-size={size}
      data-testid="builder-preview-inert-button"
      data-variant={variant}
    >
      <InertAction
        className={previewButtonSizeClasses[size]}
        colorRole={variant}
        size={size}
      >
        {text}
      </InertAction>
      {link ? (
        <output
          aria-label="Preview button destination"
          className="max-w-full truncate text-xs opacity-80"
          title={link}
        >
          {link}
        </output>
      ) : null}
    </div>
  );
}

function PreviewPlaceholder({
  label = 'Saved section',
}: PreviewPlaceholderProps) {
  return (
    <section
      aria-label={`${label} preview placeholder`}
      className="border border-dashed border-current/20 px-4 py-8 text-center text-sm"
      data-testid="builder-preview-refused-placeholder"
    >
      {label}
    </section>
  );
}

function renderPreviewInertHeader(
  props: Parameters<typeof PreviewInertHeader>[0]
) {
  return <PreviewInertHeader {...props} />;
}

export const previewInertLinkBlocks = {
  Button: { render: PreviewButton },
  Footer: { render: PreviewInertFooter },
  FAQ: { render: PreviewInertFAQ },
  Flex: { render: PreviewFlex },
  Header: { render: renderPreviewInertHeader },
  Hero: { render: PreviewInertHero },
  HeroCarousel: { render: PreviewHeroCarousel },
  PreviewPlaceholder: { render: PreviewPlaceholder },
};
