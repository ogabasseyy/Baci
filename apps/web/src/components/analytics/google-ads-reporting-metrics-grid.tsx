import {
  BarChart3,
  CheckCircle2,
  MousePointerClick,
  TrendingUp,
} from 'lucide-react';
import { GoogleAdsMetric } from '@/components/analytics/google-ads-metric';
import type { GoogleAdsReportingMetrics } from './google-ads-reporting-card';
import { formatGoogleAdsMetric } from './google-ads-reporting-format';

export function GoogleAdsReportingMetricsGrid({
  currency,
  metrics,
}: {
  currency: string;
  metrics: GoogleAdsReportingMetrics;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.spend !== undefined && (
        <GoogleAdsMetric
          formattedValue={formatGoogleAdsMetric(
            metrics.spend,
            'currency',
            currency
          )}
          icon={<TrendingUp className="size-3.5" />}
          label="Spend"
        />
      )}
      {metrics.impressions !== undefined && (
        <GoogleAdsMetric
          formattedValue={formatGoogleAdsMetric(
            metrics.impressions,
            'number',
            currency
          )}
          icon={<BarChart3 className="size-3.5" />}
          label="Impressions"
        />
      )}
      {metrics.clicks !== undefined && (
        <GoogleAdsMetric
          formattedValue={formatGoogleAdsMetric(
            metrics.clicks,
            'number',
            currency
          )}
          icon={<MousePointerClick className="size-3.5" />}
          label="Clicks"
        />
      )}
      {metrics.ctr !== undefined && (
        <GoogleAdsMetric
          formattedValue={formatGoogleAdsMetric(
            metrics.ctr,
            'percent',
            currency
          )}
          icon={<PercentIcon />}
          label="CTR"
        />
      )}
      {metrics.cpc !== undefined && (
        <GoogleAdsMetric
          formattedValue={formatGoogleAdsMetric(
            metrics.cpc,
            'currency',
            currency
          )}
          icon={<MousePointerClick className="size-3.5" />}
          label="CPC"
        />
      )}
      {metrics.conversions !== undefined && (
        <GoogleAdsMetric
          formattedValue={formatGoogleAdsMetric(
            metrics.conversions,
            'conversion',
            currency
          )}
          icon={<CheckCircle2 className="size-3.5" />}
          label="Google-attributed conversions"
        />
      )}
    </div>
  );
}

function PercentIcon() {
  return (
    <span aria-hidden="true" className="text-[11px] font-semibold">
      %
    </span>
  );
}
