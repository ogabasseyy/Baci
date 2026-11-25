import { Globe, Wallet } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { PaymentGatewaySettings } from '../payment-settings';

type PaymentPreferencesCardProps = {
  hasPaystackSubaccount: boolean;
  isPaystackSupported: boolean;
  merchantCurrencyCode: string;
  onSettingsChange: (settings: PaymentGatewaySettings) => void;
  paystackFixedFee: string;
  platformFeeCap: string | null;
  settings: PaymentGatewaySettings;
};

/** Renders BNPL and checkout gateway preferences for the active merchant. */
export function PaymentPreferencesCard({
  hasPaystackSubaccount,
  isPaystackSupported,
  merchantCurrencyCode,
  onSettingsChange,
  paystackFixedFee,
  platformFeeCap,
  settings,
}: PaymentPreferencesCardProps) {
  const paystackUnavailableLabel = !isPaystackSupported
    ? '(Unavailable)'
    : !hasPaystackSubaccount
      ? '(Add bank details)'
      : '';

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5" />
            Buy Now, Pay Later (BNPL)
          </CardTitle>
          <CardDescription>
            Let customers split payments into installments. You receive full
            payment from Credit Direct.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            className={cn(
              'p-4 rounded-lg border-2 transition-colors',
              settings.credit_direct_enabled
                ? 'border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800'
                : 'border-gray-200 dark:border-gray-800'
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-linear-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                  CD
                </div>
                <div>
                  <h3 className="font-semibold">Credit Direct</h3>
                  <p className="text-sm text-muted-foreground">
                    Customers pay in installments. You get paid in full
                    instantly.
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 px-2 py-0.5 rounded-full">
                      Pay Later
                    </span>
                    <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                      Instant Merchant Payment
                    </span>
                    <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">
                      No Interest for Customers
                    </span>
                  </div>
                </div>
              </div>
              <Switch
                aria-label="Toggle Credit Direct"
                checked={settings.credit_direct_enabled}
                onCheckedChange={(checked) =>
                  onSettingsChange({
                    ...settings,
                    credit_direct_enabled: checked,
                  })
                }
              />
            </div>
          </div>
          <div
            className={cn(
              'p-4 rounded-lg border-2 transition-colors',
              settings.oxygen_enabled
                ? 'border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800'
                : 'border-gray-200 dark:border-gray-800'
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                  O2
                </div>
                <div>
                  <h3 className="font-semibold">Oxygen</h3>
                  <p className="text-sm text-muted-foreground">
                    Device &amp; order financing in installments for eligible
                    customers. Requires an active Oxygen merchant account and
                    rollout admission to appear at checkout.
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 px-2 py-0.5 rounded-full">
                      Pay Later
                    </span>
                    <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                      Installment Financing
                    </span>
                  </div>
                </div>
              </div>
              <Switch
                aria-label="Toggle Oxygen"
                checked={settings.oxygen_enabled}
                onCheckedChange={(checked) =>
                  onSettingsChange({
                    ...settings,
                    oxygen_enabled: checked,
                  })
                }
              />
            </div>
          </div>
          <div className="p-4 rounded-lg bg-muted/50 border mt-4">
            <h4 className="font-medium mb-2">How BNPL Works</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>1. Customer selects &quot;Pay Later&quot; at checkout</li>
              <li>2. Credit Direct approves the customer instantly</li>
              <li>3. Customer pays 25-40% upfront, rest in installments</li>
              <li>4. You receive the full order amount from Credit Direct</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-5" />
            Gateway Preferences
          </CardTitle>
          <CardDescription>
            Choose which gateway to use by default for local and international
            payments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Local Payments ({merchantCurrencyCode})</Label>
              <Select
                value={settings.preferred_local_gateway}
                onValueChange={(value: 'paystack' | 'korapay') =>
                  onSettingsChange({
                    ...settings,
                    preferred_local_gateway: value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="paystack"
                    disabled={!isPaystackSupported || !hasPaystackSubaccount}
                  >
                    Paystack {paystackUnavailableLabel}
                  </SelectItem>
                  <SelectItem value="korapay">Korapay</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for {merchantCurrencyCode} payments in your storefront
              </p>
            </div>
            <div className="space-y-2">
              <Label>International Payments</Label>
              <Select
                value={settings.preferred_international_gateway}
                onValueChange={(value: 'paystack' | 'korapay') =>
                  onSettingsChange({
                    ...settings,
                    preferred_international_gateway: value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="korapay">Korapay (Recommended)</SelectItem>
                  <SelectItem
                    value="paystack"
                    disabled={!isPaystackSupported || !hasPaystackSubaccount}
                  >
                    Paystack {paystackUnavailableLabel}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for cross-border and provider-supported currencies
              </p>
            </div>
          </div>
          <div className="p-4 rounded-lg bg-muted/50 border">
            <h4 className="font-medium mb-2">Platform Fee</h4>
            <p className="text-sm text-muted-foreground">
              Baci charges{' '}
              <strong>
                {platformFeeCap
                  ? `2% per transaction, capped at ${platformFeeCap}`
                  : '2% per transaction'}
              </strong>
              . This is automatically deducted from each payment.{' '}
              {isPaystackSupported
                ? `Gateway fees (Paystack: 1.5% + ${paystackFixedFee}) are separate and borne by the platform.`
                : 'Gateway fees depend on the provider configured for your country.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
