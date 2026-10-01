// Required for interactive stat filter buttons.
'use client';

import {
  AlertTriangle,
  Building2,
  CheckCircle,
  Clock,
  XCircle,
} from 'lucide-react';
import { ADMIN_MERCHANT_SALES_ACTIVITY } from '@/config/admin-merchant-sales-activity';
import { cn } from '@/lib/utils';
import type { HealthFilter } from './merchant-health-filter';

export type { HealthFilter } from './merchant-health-filter';

export type MerchantStats = {
  total: number;
  healthy: number;
  atRisk: number;
  churned: number;
  new: number;
};

const STAT_ITEMS: Array<{
  borderClass?: string;
  filter: HealthFilter;
  icon: typeof Building2;
  iconClass: string;
  label: string;
  ringClass: string;
  valueKey: keyof MerchantStats;
}> = [
  {
    filter: 'all',
    icon: Building2,
    iconClass: 'text-primary',
    label: 'Total Merchants',
    ringClass: 'ring-primary',
    valueKey: 'total',
  },
  {
    borderClass: 'border-emerald-500/20',
    filter: 'healthy',
    icon: CheckCircle,
    iconClass: 'text-emerald-500',
    label: ADMIN_MERCHANT_SALES_ACTIVITY.healthy.label,
    ringClass: 'ring-emerald-500',
    valueKey: 'healthy',
  },
  {
    borderClass: 'border-amber-500/20',
    filter: 'at_risk',
    icon: AlertTriangle,
    iconClass: 'text-amber-500',
    label: ADMIN_MERCHANT_SALES_ACTIVITY.at_risk.label,
    ringClass: 'ring-amber-500',
    valueKey: 'atRisk',
  },
  {
    borderClass: 'border-destructive/20',
    filter: 'churned',
    icon: XCircle,
    iconClass: 'text-destructive',
    label: ADMIN_MERCHANT_SALES_ACTIVITY.churned.label,
    ringClass: 'ring-destructive',
    valueKey: 'churned',
  },
  {
    borderClass: 'border-indigo-500/20',
    filter: 'new',
    icon: Clock,
    iconClass: 'text-indigo-500',
    label: ADMIN_MERCHANT_SALES_ACTIVITY.new.label,
    ringClass: 'ring-indigo-500',
    valueKey: 'new',
  },
];

export function MerchantStatsGrid({
  activeFilter,
  onFilterChange,
  stats,
}: {
  activeFilter: HealthFilter;
  onFilterChange: (filter: HealthFilter) => void;
  stats: MerchantStats;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-5">
      {STAT_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.filter}
            type="button"
            className={cn(
              'rounded-lg border bg-card text-left text-card-foreground shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              item.borderClass,
              activeFilter === item.filter && 'ring-2',
              activeFilter === item.filter && item.ringClass
            )}
            onClick={() => onFilterChange(item.filter)}
            aria-label={`Filter merchants by ${item.label}`}
            aria-pressed={activeFilter === item.filter}
          >
            <div className="p-4">
              <div className="flex items-center gap-3">
                <Icon
                  className={cn('h-8 w-8', item.iconClass)}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-stat">{stats[item.valueKey]}</p>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
