import { buildCompareIndexDescription } from './compare-page-content-helpers';

interface CompareHubIntroProps {
  merchantName?: string | null;
}

export function CompareHubIntro({ merchantName }: CompareHubIntroProps) {
  return (
    <div className="mt-6 max-w-3xl space-y-3">
      <h1 className="text-3xl font-bold text-store-background-text md:text-4xl">
        Compare products
      </h1>
      <p className="text-sm leading-6 text-store-background-text/65 md:text-base">
        {buildCompareIndexDescription(merchantName)}
      </p>
    </div>
  );
}
