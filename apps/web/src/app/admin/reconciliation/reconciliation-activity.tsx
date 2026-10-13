import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatAdminReconciliationMoney } from '@/lib/admin-reconciliation-currency';
import type { AdminReconciliationData } from '@/schemas/admin-reconciliation-rpc';

function describeLane(lane: string): string {
  return lane.replaceAll('_', ' ');
}

type ReconciliationItemWithMoney = AdminReconciliationData['items'][number] & {
  amount: number;
  currency: string;
};

function canDisplayItemMoney(
  item: AdminReconciliationData['items'][number]
): item is ReconciliationItemWithMoney {
  return (
    item.lane !== 'platform_settlement' &&
    item.lane !== 'direct_settlement' &&
    item.amount !== null &&
    item.currency !== null
  );
}

export function ReconciliationActivity({
  data,
  loadingMore,
  onLoadMore,
}: {
  data: AdminReconciliationData | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Reconciliation activity</CardTitle>
        <CardDescription>
          Open reviews include every unresolved review, regardless of the
          selected money period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data && data.items.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No safe reconciliation records match these filters.
          </div>
        ) : null}
        {data && data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Merchant</th>
                  <th className="p-3">Lane</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Currency</th>
                  <th className="p-3">Provider / issue</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    className="border-b last:border-0"
                    key={`${item.lane}-${item.id}`}
                  >
                    <td className="p-3 whitespace-nowrap">
                      {new Date(item.occurredAt).toLocaleString()}
                    </td>
                    <td className="p-3">{item.merchantName}</td>
                    <td className="p-3 capitalize">
                      {describeLane(item.lane)}
                    </td>
                    <td className="p-3 capitalize">
                      {item.status.replaceAll('_', ' ')}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {canDisplayItemMoney(item)
                        ? formatAdminReconciliationMoney(
                            item.amount,
                            item.currency
                          )
                        : '—'}
                    </td>
                    <td className="p-3">
                      {canDisplayItemMoney(item) ? item.currency : '—'}
                    </td>
                    <td className="p-3">
                      {item.issueType ?? item.provider.replaceAll('_', ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.nextCursor ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
