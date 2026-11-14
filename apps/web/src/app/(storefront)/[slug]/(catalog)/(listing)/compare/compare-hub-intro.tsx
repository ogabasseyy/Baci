import type { ReactNode } from 'react';
import { buildCompareIndexDescription } from './compare-page-content-helpers';

interface CompareHubIntroProps {
  description?: ReactNode;
  merchantName?: string | null;
}

export function CompareHubIntro({
  description,
  merchantName,
}: CompareHubIntroProps) {
  return (
    <div className="mt-6 max-w-3xl space-y-3" data-compare-hub-intro="">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-store-primary/20 bg-store-primary/10 px-3 py-1 text-xs font-semibold text-store-primary">
        <span>Device Comparison Hub</span>
      </div>
      <div data-cwv-lcp-fold="" className="min-h-0">
        <h1
          className="text-3xl font-bold tracking-tight text-store-background-text md:text-4xl"
          data-cwv-lcp-copy="compare"
        >
          Compare products
        </h1>
      </div>
      <p
        className="text-sm leading-relaxed text-store-background-text/70"
        data-compare-hub-intro-pending={
          description || !merchantName ? '' : undefined
        }
        data-cwv-lcp-support=""
      >
        {buildCompareIndexDescription(merchantName)}
      </p>
      {description}
      <div className="flex flex-wrap items-center gap-4 pt-2 text-xs font-medium text-store-background-text/75 sm:gap-6">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-store-primary">✓</span>
          <span>Side-by-side specs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-store-primary">✓</span>
          <span>Verified market pricing</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-store-primary">✓</span>
          <span>Warranty & condition clarity</span>
        </div>
      </div>
    </div>
  );
}
