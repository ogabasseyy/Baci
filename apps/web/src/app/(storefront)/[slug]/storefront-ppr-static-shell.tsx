import type React from 'react';
import { Suspense } from 'react';
import {
  getStorefrontAppearanceClasses,
  type StorefrontAppearance,
} from '@/components/storefront/storefront-appearance';

export function StorefrontPprStaticShell({
  children,
  dynamicSlot,
  loadingFallback,
  appearance,
}: {
  children: React.ReactNode;
  dynamicSlot?: React.ReactNode;
  loadingFallback: React.ReactNode;
  appearance: StorefrontAppearance;
}) {
  const appearanceClassName =
    getStorefrontAppearanceClasses(appearance).join(' ');

  return (
    <div
      className={`storefront-ppr-static-shell ${appearanceClassName}`}
      data-storefront-shell=""
    >
      <div className="storefront-ppr-static-shell__content">{children}</div>
      {loadingFallback ? (
        <div className="storefront-ppr-static-shell__fallback">
          {loadingFallback}
        </div>
      ) : null}
      {dynamicSlot ? <Suspense fallback={null}>{dynamicSlot}</Suspense> : null}
    </div>
  );
}
