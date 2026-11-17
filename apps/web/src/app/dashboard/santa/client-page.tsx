'use client';

import { formatDistanceToNow } from 'date-fns';
import { MessageCircle, ShoppingBag, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BagLoader } from '@/components/ui/bag-loader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMerchant } from '@/hooks/use-merchant-client';
import { formatMerchantCurrency } from '@/lib/resolve-merchant-currency';
import { useSantaPolling } from './use-santa-polling';

export default function SantaClientPage() {
  const { merchant, loading: merchantLoading } = useMerchant();
  const {
    interactions,
    loading,
    pollError,
    pollingPaused,
    restartPolling,
    stats,
  } = useSantaPolling(merchant?.id);

  if (merchantLoading || loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <BagLoader size={48} />
      </div>
    );
  }

  // Helper to format currency
  const formatMoney = (amount: number) => {
    return formatMerchantCurrency(amount, {
      country: merchant?.country,
      payout_currency: merchant?.payout_currency,
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-linear-to-r from-red-600 to-green-600 bg-clip-text text-transparent">
            Santa Campaign Analytics 🎅
          </h1>
          <p className="text-muted-foreground">
            Real-time insights from the North Pole AI agent.
          </p>
        </div>
        {pollingPaused || pollError ? (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{pollError ?? 'Live updates paused'}</span>
            <button
              className="rounded-md border px-2.5 py-1 font-medium text-foreground hover:bg-muted"
              onClick={restartPolling}
              type="button"
            >
              Refresh
            </button>
          </div>
        ) : null}
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-red-100 bg-red-50/30 dark:bg-red-950/10">
          <CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <ShoppingBag className="size-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatMoney(stats?.total_revenue || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Generated from Santa's deals
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-100 bg-blue-50/30 dark:bg-blue-950/10">
          <CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversations</CardTitle>
            <MessageCircle className="size-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total_chats || 0}</div>
            <p className="text-xs text-muted-foreground">
              Active sessions: {stats?.unique_sessions || 0}
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-100 bg-green-50/30 dark:bg-green-950/10">
          <CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Wishes Granted
            </CardTitle>
            <ThumbsUp className="size-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.wishes_granted || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Average discount given: {Math.round(stats?.avg_discount || 0)}%
            </p>
          </CardContent>
        </Card>

        <Card className="border-orange-100 bg-orange-50/30 dark:bg-orange-950/10">
          <CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wishes Denied</CardTitle>
            <ThumbsDown className="size-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.wishes_denied || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Rejected due to budget
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Area */}
      <div className="grid gap-4 md:grid-cols-7 lg:grid-cols-7">
        {/* Recent Interactions Feed */}
        <Card className="col-span-7 lg:col-span-7">
          <CardHeader>
            <CardTitle>Live Activity Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {interactions.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  No interactions yet. Santa is waiting! ❄️
                </div>
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                      <tr>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3 max-w-md">
                          Message & Response
                        </th>
                        <th className="px-4 py-3 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interactions.map((interaction) => (
                        <tr
                          key={interaction.id}
                          className="border-b hover:bg-muted/10 transition-colors"
                        >
                          <td className="px-4 py-3 font-medium whitespace-nowrap text-muted-foreground">
                            {formatDistanceToNow(
                              new Date(interaction.created_at),
                              { addSuffix: true }
                            )}
                          </td>
                          <td className="px-4 py-3">Guest</td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                interaction.interaction_type === 'wish_granted'
                                  ? 'default'
                                  : interaction.interaction_type ===
                                      'wish_denied'
                                    ? 'destructive'
                                    : interaction.interaction_type ===
                                        'checkout_completed'
                                      ? 'secondary'
                                      : 'outline'
                              }
                              className="capitalize"
                            >
                              {interaction.interaction_type.replace('_', ' ')}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 max-w-lg">
                            <div className="flex flex-col gap-1">
                              <div className="p-2 rounded bg-muted/30 text-xs italic">
                                "{interaction.user_message}"
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                🎅 {interaction.santa_response}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {interaction.approved_price
                              ? formatMoney(interaction.approved_price)
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
