import {
  ArrowLeft,
  CircleAlert,
  CreditCard,
  PackageCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatAdminThresholdCurrencyForCode } from '@/lib/admin-currency';
import {
  formatAdminMerchantDate,
  formatAdminMerchantEnumLabel,
} from '@/lib/admin-merchant-utils';
import type { AdminMerchant360Response } from '@/types/admin-merchant-360';
import { Merchant360MetricCard } from './merchant-360-metric-card';
import { Merchant360ReadinessItem } from './merchant-360-readiness-item';

export function Merchant360Content({
  data,
}: {
  data: AdminMerchant360Response;
}) {
  const merchantName = data.merchant.businessName ?? 'Unnamed merchant';
  const totalIncidents =
    data.incidents.domainEventFailures30d +
    data.incidents.eventDeliveryDeadLetters30d +
    data.incidents.shipmentFailures30d;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/merchants">
            <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
            Merchants
          </Link>
        </Button>
        <div>
          <h1 className="text-page-title">{merchantName}</h1>
          <p className="text-muted-foreground">
            Merchant 360: storefront readiness, sales, money movement, and
            recent operations.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Merchant360MetricCard
          icon={Users}
          label="Customers"
          value={data.summary.customerUsers}
        />
        <Merchant360MetricCard
          icon={PackageCheck}
          label="Paid orders (all currencies)"
          value={data.sales.paidOrders}
        />
        <Merchant360MetricCard
          icon={CreditCard}
          label={`Paid GMV (${data.moneyCurrency} only)`}
          value={formatAdminThresholdCurrencyForCode(
            data.sales.paidGmv,
            data.moneyCurrency
          )}
        />
        <Merchant360MetricCard
          icon={CircleAlert}
          label="Recent incidents (30d)"
          value={totalIncidents}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Store readiness</CardTitle>
            <CardDescription>
              {data.domain.primaryDomain ??
                data.merchant.slug ??
                'No storefront address'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Merchant360ReadinessItem
              label="Storefront"
              ready={data.readiness.storefrontReady}
            />
            <Merchant360ReadinessItem
              label="Published"
              ready={data.readiness.isPublished}
            />
            <Merchant360ReadinessItem
              label="Payments"
              ready={data.readiness.paymentConfigured}
            />
            <Merchant360ReadinessItem
              label="Shipping"
              ready={data.readiness.shippingConfigured}
            />
            <Merchant360ReadinessItem
              label="Primary domain verified"
              ready={data.domain.hasPrimary && Boolean(data.domain.verifiedAt)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Money movement</CardTitle>
            <CardDescription>
              Paid GMV uses {data.moneyCurrency} only. Latest currently-paid
              order by order-created time across all currencies:{' '}
              {formatAdminMerchantDate(data.sales.lastPaidAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">Settlements</p>
              <p className="text-sm text-muted-foreground">
                {data.settlements.pendingCount} pending ·{' '}
                {data.settlements.failedCount} failed
              </p>
              <p className="text-sm text-muted-foreground">
                Amounts unavailable: the settlement ledger does not record a
                currency.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">Payouts</p>
              <p className="text-sm text-muted-foreground">
                {data.payouts.pendingCount} pending · {data.payouts.failedCount}{' '}
                failed
              </p>
              <p className="text-sm text-muted-foreground">
                {data.payouts.pendingAmount === null
                  ? 'Amounts unavailable across multiple currencies.'
                  : `${formatAdminThresholdCurrencyForCode(
                      data.payouts.pendingAmount,
                      data.moneyCurrency
                    )} pending`}
              </p>
            </div>
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {data.sales.displayCurrencyPaidOrders} paid {data.moneyCurrency}{' '}
              orders contribute to GMV.{' '}
              {data.sales.excludedNonDisplayCurrencyPaidOrders} paid orders in
              other or unknown currencies are excluded from it.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Access footprint</CardTitle>
            <CardDescription>
              Aggregate access counts only. People-level account and contact
              information requires a separately audited permission.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="rounded-md border p-3 text-sm">
                <span className="font-medium">{data.summary.webUsers}</span> web
                users
              </p>
              <p className="rounded-md border p-3 text-sm">
                <span className="font-medium">{data.summary.staffUsers}</span>{' '}
                staff accounts
              </p>
              <p className="rounded-md border p-3 text-sm">
                <span className="font-medium">
                  {data.summary.activeAdminAppInstallations}
                </span>{' '}
                active admin app installs
              </p>
              <p className="rounded-md border p-3 text-sm">
                <span className="font-medium">
                  {data.summary.activeStorefrontAppInstallations}
                </span>{' '}
                active storefront app installs
              </p>
            </div>
            {data.staffAccess.length > 0 ? (
              data.staffAccess.map((access) => (
                <div
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                  key={`${access.role}-${access.status}`}
                >
                  <span>
                    {formatAdminMerchantEnumLabel(access.role)} ·{' '}
                    {formatAdminMerchantEnumLabel(access.status)}
                  </span>
                  <span className="font-medium">{access.users}</span>
                </div>
              ))
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No staff accounts yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent audit activity</CardTitle>
            <CardDescription>
              Changed field names only; values and request metadata are never
              shown in this view.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentAuditEvents.length > 0 ? (
              data.recentAuditEvents.map((event) => (
                <div
                  className="rounded-md border p-3 text-sm"
                  key={`${event.occurredAt}-${event.action}-${event.resourceType}`}
                >
                  <p className="font-medium">
                    {formatAdminMerchantEnumLabel(event.action)} ·{' '}
                    {formatAdminMerchantEnumLabel(event.resourceType)}
                  </p>
                  <p className="text-muted-foreground">
                    {event.changedFields.length > 0
                      ? event.changedFields
                          .map(formatAdminMerchantEnumLabel)
                          .join(', ')
                      : 'No changed fields recorded'}
                    {' · '}
                    {formatAdminMerchantDate(event.occurredAt)}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No canonical audit activity recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
