import { History, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PointsTransaction } from '@/lib/loyalty-data-client';

export function RewardsHistory({
  transactions,
}: {
  transactions: PointsTransaction[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Points History</CardTitle>
        <CardDescription>Your recent points activity</CardDescription>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-center py-8">
            <History className="size-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No transactions yet</p>
            <p className="text-sm text-muted-foreground">
              Make a purchase to start earning points
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {transactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between py-3 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-full ${
                      transaction.points > 0
                        ? 'bg-store-primary/10'
                        : 'bg-destructive/10'
                    }`}
                  >
                    {transaction.points > 0 ? (
                      <TrendingUp className="size-4 text-store-primary" />
                    ) : (
                      <TrendingDown className="size-4 text-destructive" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {transaction.description}
                    </p>
                    {transaction.redemption_code ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        Code: {transaction.redemption_code}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {new Date(transaction.created_at).toLocaleDateString(
                        undefined,
                        {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        }
                      )}
                    </p>
                  </div>
                </div>
                <span
                  className={`font-semibold ${
                    transaction.points > 0
                      ? 'text-store-primary'
                      : 'text-destructive'
                  }`}
                >
                  {transaction.points > 0 ? '+' : ''}
                  {transaction.points.toLocaleString()} pts
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
