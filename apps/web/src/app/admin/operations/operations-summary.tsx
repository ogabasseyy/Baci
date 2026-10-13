import {
  BellRing,
  CreditCard,
  PackageX,
  RadioTower,
  RefreshCw,
  Scale,
  WalletCards,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { AdminOperations } from '@/schemas/admin-operations-rpc';

const cards = [
  { icon: Scale, key: 'reconciliationReview', label: 'Reconciliation review' },
  {
    icon: CreditCard,
    key: 'paymentSideEffects',
    label: 'Payment side effects',
  },
  { icon: WalletCards, key: 'settlements', label: 'Settlement issues' },
  { icon: RefreshCw, key: 'payouts', label: 'Payout issues' },
  { icon: BellRing, key: 'notifications', label: 'Notification failures' },
  { icon: PackageX, key: 'shipping', label: 'Shipping failures' },
  { icon: RadioTower, key: 'workers', label: 'Unhealthy workers' },
] as const;

export function OperationsSummary({
  canReadFinancials,
  summary,
}: {
  canReadFinancials: boolean;
  summary: AdminOperations['summary'];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards
        .filter(
          ({ key }) =>
            canReadFinancials || (key !== 'settlements' && key !== 'payouts')
        )
        .map(({ icon: Icon, key, label }) => (
          <Card key={key}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-full bg-muted p-2.5">
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary[key]}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
