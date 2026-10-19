import { buildCompareIndexDescription } from './compare-page-content-helpers';

export function CompareHubIntroDescription({
  merchantName,
}: {
  merchantName: string;
}) {
  return (
    <p
      className="text-sm text-store-background-text/70"
      data-compare-hub-intro-resolved=""
      data-cwv-lcp-support=""
    >
      {buildCompareIndexDescription(merchantName)}
    </p>
  );
}
