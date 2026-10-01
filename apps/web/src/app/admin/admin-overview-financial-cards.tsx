import { Banknote, DollarSign, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlatformAnalytics } from '@/types/analytics';
import { adminOverviewUtils } from './admin-overview-utils';

interface AdminOverviewFinancialCardsProps {
  analytics: PlatformAnalytics | null;
  loading: boolean;
}

const SKELETON_IDS = [
  'financial-skeleton-1',
  'financial-skeleton-2',
  'financial-skeleton-3',
];

interface FinancialCardProps {
  amount: number | null;
  amountClassName: string;
  description: string;
  icon: typeof Banknote;
  iconClassName: string;
  iconContainerClassName: string;
  title: string;
  toneClassName: string;
}

function FinancialCard({
  amount,
  amountClassName,
  description,
  icon: Icon,
  iconClassName,
  iconContainerClassName,
  title,
  toneClassName,
}: FinancialCardProps) {
  return (
    <Card className={toneClassName}>
      <CardContent className="flex items-center gap-4 p-6">
        <div className={iconContainerClassName}>
          <Icon className={iconClassName} />
        </div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className={`text-2xl font-bold ${amountClassName}`}>
            {amount === null
              ? 'Unavailable'
              : adminOverviewUtils.formatCurrency(amount)}
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminOverviewFinancialCards({
  analytics,
  loading,
}: AdminOverviewFinancialCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {loading ? (
        SKELETON_IDS.map((skeletonId) => (
          <Card key={skeletonId} className="p-6">
            <Skeleton className="h-4 w-24 mb-4" />
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-20" />
          </Card>
        ))
      ) : analytics ? (
        <>
          <FinancialCard
            amount={analytics.summary.recordedPlatformFees}
            amountClassName="text-emerald-600"
            description="Unavailable: settlement currency is not recorded"
            icon={Banknote}
            iconClassName="size-6 text-emerald-500"
            iconContainerClassName="p-3 rounded-full bg-emerald-500/10"
            title="Recorded Platform Fees"
            toneClassName="border-emerald-500/20 bg-emerald-500/5"
          />
          <FinancialCard
            amount={analytics.summary.recordedProcessorFees}
            amountClassName="text-orange-600"
            description="Unavailable: settlement currency is not recorded"
            icon={DollarSign}
            iconClassName="size-6 text-orange-500"
            iconContainerClassName="p-3 rounded-full bg-orange-500/10"
            title="Recorded Processor Fees"
            toneClassName="border-orange-500/20 bg-orange-500/5"
          />
          <FinancialCard
            amount={analytics.summary.recordedMerchantNet}
            amountClassName="text-blue-600"
            description="Unavailable: settlement currency is not recorded"
            icon={Wallet}
            iconClassName="size-6 text-blue-500"
            iconContainerClassName="p-3 rounded-full bg-blue-500/10"
            title="Recorded Merchant Net"
            toneClassName="border-blue-500/20 bg-blue-500/5"
          />
        </>
      ) : null}
    </div>
  );
}
