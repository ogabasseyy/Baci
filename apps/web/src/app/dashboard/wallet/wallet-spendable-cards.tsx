import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { WalletSpendableBreakdown } from '@/lib/wallet/wallet-spendable-breakdown';

interface Props {
  spendable: WalletSpendableBreakdown;
  formatMoney: (amount: number) => string;
}

export function WalletSpendableCards({ spendable, formatMoney }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Spendable</CardDescription>
          <CardTitle className="text-2xl">
            {formatMoney(spendable.spendableBalance)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            What GIG shipping bookings can use from your wallet.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Settled to your bank by Paystack</CardDescription>
          <CardTitle className="text-2xl">
            {formatMoney(spendable.settledToBankTotal)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Card and Paystack sales are already paid straight to your bank. They
            are shown for your records only and cannot be spent or withdrawn
            from this wallet.
          </p>
          {spendable.pendingReconciliationTotal > 0 ? (
            <p className="text-xs text-muted-foreground mt-2">
              Not included above:{' '}
              {formatMoney(spendable.pendingReconciliationTotal)} of older
              Paystack sales is being reviewed. It is not spendable until we
              confirm where it was paid.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
