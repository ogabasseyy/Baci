import { buildCompareIndexDescription } from './compare-page-content-helpers';

interface CompareHubIntroProps {
  merchantName?: string | null;
}

export function CompareHubIntro({ merchantName }: CompareHubIntroProps) {
  return (
    <div className="mt-6 max-w-3xl space-y-3" data-cwv-lcp-fold="">
      <h1
        className="text-3xl font-bold text-store-background-text md:text-4xl"
        data-cwv-lcp-copy="compare"
      >
        Compare products
      </h1>
      <p
        className="text-sm text-store-background-text/70"
        data-cwv-lcp-support=""
      >
        {buildCompareIndexDescription(merchantName)}
      </p>
    </div>
  );
}
