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
    <div className="mt-6 max-w-3xl space-y-3">
      <div data-cwv-lcp-fold="">
        <h1
          className="text-3xl font-bold text-store-background-text md:text-4xl"
          data-cwv-lcp-copy="compare"
        >
          Compare products
        </h1>
      </div>
      <p
        className="text-sm text-store-background-text/70"
        data-compare-hub-intro-pending={
          description || !merchantName ? '' : undefined
        }
        data-cwv-lcp-support=""
      >
        {buildCompareIndexDescription(merchantName)}
      </p>
      {description}
    </div>
  );
}
