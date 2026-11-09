'use client';

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CalendarClock,
  Clock,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { WalletSpendableBreakdown } from '@/lib/wallet/wallet-spendable-breakdown';
import {
  type PendingSettlement,
  type Transaction,
  updateWalletSettings,
  type WalletData,
} from './actions';
import { getWalletPayoutAmountOptions } from './wallet-payout-options';
import { WalletSpendableCards } from './wallet-spendable-cards';

interface WalletClientProps {
  wallet: WalletData | null;
  pendingSettlements: PendingSettlement[];
  transactions: Transaction[];
  merchantId: string;
  payoutCurrency?: string | null;
  spendable?: WalletSpendableBreakdown | null;
}

export default function WalletClient({
  wallet,
  pendingSettlements,
  transactions,
  merchantId,
  payoutCurrency = 'NGN',
  spendable = null,
}: WalletClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savingSettings, setSavingSettings] = useState(false);

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const updateSettings = (updates: {
    autoPayoutEnabled?: boolean;
    autoPayoutDay?: string;
    minPayoutAmount?: number;
  }) => {
    setSavingSettings(true);
    updateWalletSettings(merchantId, updates)
      .then((result) => {
        if (!result.success) {
          throw new Error(result.error || 'Failed to update settings');
        }

        toast({ title: 'Success', description: 'Settings updated' });

        startTransition(() => {
          router.refresh();
        });
      })
      .catch((error: unknown) => {
        console.error('Failed to update wallet settings:', error);
        toast({
          title: 'Error',
          description: 'Failed to update settings',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setSavingSettings(false);
      });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
    });
  };

  const formatMoney = (amount: number) =>
    formatDisplayCurrency(amount, payoutCurrency || 'NGN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  const payoutAmountOptions = getWalletPayoutAmountOptions(
    payoutCurrency,
    wallet?.minPayoutAmount
  );

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'credit':
        return <ArrowDownToLine className="size-4 text-green-500" />;
      case 'withdrawal':
      case 'payout':
        return <ArrowUpFromLine className="size-4 text-blue-500" />;
      default:
        return <Wallet className="size-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default">Completed</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getGatewayBadge = (gateway: string) => {
    const colors: Record<string, string> = {
      paystack: 'bg-blue-100 text-blue-800',
      korapay: 'bg-purple-100 text-purple-800',
      credit_direct: 'bg-orange-100 text-orange-800',
      kuda: 'bg-green-100 text-green-800',
    };
    return (
      <span
        className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${colors[gateway] || 'bg-gray-100 text-gray-800'}`}
      >
        {gateway.replace('_', ' ')}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Wallet</h1>
          <p className="text-muted-foreground">
            Track your earnings from sales and VTU commissions
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isPending}
        >
          <RefreshCw
            className={`size-4 mr-2 ${isPending ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {spendable ? (
        <WalletSpendableCards spendable={spendable} formatMoney={formatMoney} />
      ) : null}

      {/* Balance Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {/* Available Balance - Primary Card */}
        <Card className="md:col-span-2 lg:col-span-2 border-green-200 bg-green-50/50 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Banknote className="size-4" />
              Available Balance
            </CardDescription>
            <CardTitle className="text-4xl text-green-600">
              {formatMoney(wallet?.availableBalance || 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button className="w-full" disabled>
              Withdrawals Disabled
            </Button>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Withdrawals are currently disabled
            </p>
          </CardContent>
        </Card>

        {/* Upcoming Settlements */}
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <CalendarClock className="size-4" />
              Upcoming
            </CardDescription>
            <CardTitle className="text-2xl text-amber-600">
              {formatMoney(wallet?.upcomingBalance || 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {wallet?.nextSettlementDate ? (
              <p className="text-xs text-muted-foreground">
                {wallet.upcomingCount} settlement
                {wallet.upcomingCount !== 1 ? 's' : ''} arriving
                <span className="block font-medium text-amber-700">
                  Next: {formatShortDate(wallet.nextSettlementDate)}
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                No pending settlements
              </p>
            )}
          </CardContent>
        </Card>

        {/* Processing Payouts */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="size-4" />
              Processing
            </CardDescription>
            <CardTitle className="text-2xl">
              {formatMoney(wallet?.pendingBalance || 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Pending Payouts</p>
          </CardContent>
        </Card>

        {/* Total Earned */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="size-4" />
              Total Earned
            </CardDescription>
            <CardTitle className="text-2xl">
              {formatMoney(wallet?.totalEarned || 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Withdrawn: {formatMoney(wallet?.totalWithdrawn || 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Settlements Section */}
      {pendingSettlements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarClock className="size-5 text-amber-500" />
              Upcoming Settlements
            </CardTitle>
            <CardDescription>
              Payments that will be available soon
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingSettlements.map((settlement) => (
                <div
                  key={settlement.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-amber-100 flex items-center justify-center">
                      <ArrowDownToLine className="size-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {settlement.description}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {getGatewayBadge(settlement.gateway)}
                        <span>•</span>
                        <span className="capitalize">
                          {settlement.sourceType.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600">
                      +{formatMoney(settlement.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatShortDate(settlement.expectedDate)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settings and Transactions */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Auto-Payout Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="size-5" />
              Auto-Payout Settings
            </CardTitle>
            <CardDescription>
              Automatically withdraw earnings weekly
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-payout">Enable Auto-Payout</Label>
              <Switch
                id="auto-payout"
                checked={wallet?.autoPayoutEnabled || false}
                onCheckedChange={(checked) =>
                  updateSettings({ autoPayoutEnabled: checked })
                }
                disabled={savingSettings}
              />
            </div>

            {wallet?.autoPayoutEnabled && (
              <>
                <div className="space-y-2">
                  <Label>Payout Day</Label>
                  <Select
                    value={wallet?.autoPayoutDay || 'monday'}
                    onValueChange={(value) =>
                      updateSettings({ autoPayoutDay: value })
                    }
                    disabled={savingSettings}
                  >
                    <SelectTrigger aria-label="Select payout day">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monday">Monday</SelectItem>
                      <SelectItem value="tuesday">Tuesday</SelectItem>
                      <SelectItem value="wednesday">Wednesday</SelectItem>
                      <SelectItem value="thursday">Thursday</SelectItem>
                      <SelectItem value="friday">Friday</SelectItem>
                      <SelectItem value="saturday">Saturday</SelectItem>
                      <SelectItem value="sunday">Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Minimum Payout Amount</Label>
                  <Select
                    value={String(wallet?.minPayoutAmount || 1000)}
                    onValueChange={(value) =>
                      updateSettings({ minPayoutAmount: Number(value) })
                    }
                    disabled={savingSettings}
                  >
                    <SelectTrigger aria-label="Select minimum payout amount">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {payoutAmountOptions.map((amount) => (
                        <SelectItem key={amount} value={String(amount)}>
                          {formatMoney(amount)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Payout only triggers when balance exceeds this amount
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Recent Transactions</CardTitle>
            <CardDescription>Your wallet activity</CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Wallet className="size-12 mx-auto mb-3 opacity-50" />
                <p>No transactions yet</p>
                <p className="text-sm">
                  Earnings from sales and VTU will appear here
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getTypeIcon(tx.type)}
                          <span className="capitalize">{tx.type}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {tx.description}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          tx.type === 'credit'
                            ? 'text-green-600'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}
                      >
                        {tx.type === 'credit' ? '+' : '-'}
                        {formatMoney(tx.amount)}
                      </TableCell>
                      <TableCell>{getStatusBadge(tx.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(tx.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
