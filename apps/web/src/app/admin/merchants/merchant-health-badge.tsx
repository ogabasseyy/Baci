import { AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { ADMIN_MERCHANT_SALES_ACTIVITY } from '@/config/admin-merchant-sales-activity';
import type { AdminMerchantHealthRow } from '@/types/admin-merchants';

type MerchantHealthStatus =
  | AdminMerchantHealthRow['health_status']
  | (string & {});
const UNKNOWN_HEALTH_STATUS_LABEL = 'Unknown';

function StatusBadge({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <Badge
      aria-label={label}
      className={className}
      role="status"
      variant="outline"
    >
      {children}
    </Badge>
  );
}

export function MerchantHealthBadge({
  status,
}: {
  status: MerchantHealthStatus | null | undefined;
}) {
  switch (status) {
    case 'healthy':
      return (
        <StatusBadge
          className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
          label={ADMIN_MERCHANT_SALES_ACTIVITY.healthy.label}
        >
          <CheckCircle className="mr-1 size-3" aria-hidden="true" />
          {ADMIN_MERCHANT_SALES_ACTIVITY.healthy.label}
        </StatusBadge>
      );
    case 'at_risk':
      return (
        <StatusBadge
          className="border-amber-500/20 bg-amber-500/10 text-amber-600"
          label={ADMIN_MERCHANT_SALES_ACTIVITY.at_risk.label}
        >
          <AlertTriangle className="mr-1 size-3" aria-hidden="true" />
          {ADMIN_MERCHANT_SALES_ACTIVITY.at_risk.label}
        </StatusBadge>
      );
    case 'churned':
      return (
        <StatusBadge
          className="border-destructive/20 bg-destructive/10 text-destructive"
          label={ADMIN_MERCHANT_SALES_ACTIVITY.churned.label}
        >
          <XCircle className="mr-1 size-3" aria-hidden="true" />
          {ADMIN_MERCHANT_SALES_ACTIVITY.churned.label}
        </StatusBadge>
      );
    case 'new':
      return (
        <StatusBadge
          className="border-indigo-500/20 bg-indigo-500/10 text-indigo-600"
          label={ADMIN_MERCHANT_SALES_ACTIVITY.new.label}
        >
          <Clock className="mr-1 size-3" aria-hidden="true" />
          {ADMIN_MERCHANT_SALES_ACTIVITY.new.label}
        </StatusBadge>
      );
    default:
      return (
        <StatusBadge label={status || UNKNOWN_HEALTH_STATUS_LABEL}>
          {status || UNKNOWN_HEALTH_STATUS_LABEL}
        </StatusBadge>
      );
  }
}
