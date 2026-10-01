import Image from 'next/image';
import {
  OGABASSEY_SHELL_BANNER_INLINE_HEIGHT,
  OGABASSEY_SHELL_BANNER_INLINE_SRC,
  OGABASSEY_SHELL_BANNER_INLINE_WIDTH,
} from '@/config/ogabassey-shell-banner-inline';
import { HeroMobileControlsSkeleton } from './hero-mobile-controls-skeleton';

// Permanent, product-agnostic geometry for a published store whose launch feed
// is empty. The inline AVIF is a large first-flush LCP candidate (zero network)
// and matches the populated mobile hero's h-48 box. It deliberately has no CTA
// or stock claim: feed degradation must not create a dead or misleading action.
// Regenerate the art with scripts/generate-ogabassey-shell-banner.mjs.
export function OgabasseyEmptyMobileHero() {
  return (
    <div className="mb-4" aria-hidden="true">
      <div className="relative rounded-2xl overflow-hidden shadow-2xl h-48 ring-1 ring-store-border/70 bg-store-secondary">
        <div className="absolute inset-0 bg-store-secondary">
          <Image
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            decoding="sync"
            fetchPriority="high"
            height={OGABASSEY_SHELL_BANNER_INLINE_HEIGHT}
            loading="eager"
            src={OGABASSEY_SHELL_BANNER_INLINE_SRC}
            unoptimized
            width={OGABASSEY_SHELL_BANNER_INLINE_WIDTH}
          />
          <div className="relative z-10 flex h-full items-center px-6 py-5">
            <div className="w-[46%] pr-2 text-store-secondary-text">
              <h2 className="mb-2 font-sans text-2xl font-extrabold leading-tight drop-shadow-xs">
                Discover what's next
              </h2>
              <p className="text-[11px] font-medium leading-relaxed opacity-90">
                Explore phones, laptops, gaming and more.
              </p>
            </div>
          </div>
        </div>
      </div>
      {/* The streaming reserve fallback bets on a multi-slide hero: keep its
          controls-row slot (empty but sized) so the swap moves nothing. */}
      <HeroMobileControlsSkeleton invisible />
    </div>
  );
}
