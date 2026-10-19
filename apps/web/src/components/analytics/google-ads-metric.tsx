import type { ReactNode } from 'react';

export interface GoogleAdsMetricProps {
  formattedValue: string;
  icon: ReactNode;
  label: string;
}

export function GoogleAdsMetric({
  formattedValue,
  icon,
  label,
}: GoogleAdsMetricProps) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {formattedValue}
      </p>
    </div>
  );
}
