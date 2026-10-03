import Link from 'next/link';
import { Logo } from '@/components/logo';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { ProjectedPilotImage } from './next-image-adapter';

// Lab-only clone of HeaderLogo (components/storefront/blocks/header-logo.tsx)
// with only the image element changed: the next/image is replaced by the
// projected <picture> (explicit staged srcSets, no ?w&q loader params on
// immutable variants). Link, order classes, 40x40 box, alt, rounded-full
// object-cover styling, and store name are verbatim. The control arm renders
// the ORIGINAL HeaderLogo with the staged original URL; this clone renders
// the pilot arm. See lab-header-clone.test.tsx for the structural parity
// proof (clone-control vs original).
export function LabHeaderLogo({
  getHref,
  layout,
  projection,
  storeName,
}: {
  getHref: (path: string) => string;
  layout: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  projection: ProjectedPilotImage;
  storeName: string;
}) {
  return (
    <Link
      href={asRoute(getHref('/'))}
      className={cn('flex items-center gap-2 group shrink-0', {
        'order-1': layout !== 'logo-center',
        'order-2 mx-auto': layout === 'logo-center',
      })}
    >
      <picture data-pilot-lab-header-logo="true">
        {projection.sources.map((source) => (
          <source
            key={source.format}
            sizes={projection.sizes}
            srcSet={source.srcSet}
            type={`image/${source.format}`}
          />
        ))}
        <img
          src={projection.fallbackSrc}
          alt={storeName}
          width={40}
          height={40}
          // Mirror next/image's effective defaults for the original element
          // (no priority/loading props there): lazy, auto priority.
          loading="lazy"
          fetchPriority="auto"
          decoding="async"
          sizes={projection.sizes}
          className="rounded-full object-cover ring-2 ring-white/50 shadow-sm transition-transform group-hover:scale-105"
        />
      </picture>
      <span
        className={cn('font-bold text-xl tracking-tight transition-colors')}
      >
        {storeName}
      </span>
    </Link>
  );
}

// Lab header bar: the lockup is the selected slot, so the bar is a plain
// landmark placing it top-of-page. Production chrome (search/cart/nav/
// account), glass scroll states, and sticky positioning are excluded —
// identical across arms and irrelevant to the 40px slot's fetch sequence.
export function LabStoreHeader({
  children,
  storeName,
}: {
  children: React.ReactNode;
  storeName: string;
}) {
  return (
    <header data-pilot-lab-store-header={storeName}>
      <div className="flex items-center gap-2 px-4 py-4 md:px-8">
        {children}
      </div>
    </header>
  );
}

export function LabHeaderLogoFallback({
  getHref,
  layout,
  storeName,
}: {
  getHref: (path: string) => string;
  layout: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  storeName: string;
}) {
  return (
    <Link
      href={asRoute(getHref('/'))}
      className={cn('flex items-center gap-2 group shrink-0', {
        'order-1': layout !== 'logo-center',
        'order-2 mx-auto': layout === 'logo-center',
      })}
    >
      <Logo className="transition-transform group-hover:scale-105" />
      <span
        className={cn('font-bold text-xl tracking-tight transition-colors')}
      >
        {storeName}
      </span>
    </Link>
  );
}
