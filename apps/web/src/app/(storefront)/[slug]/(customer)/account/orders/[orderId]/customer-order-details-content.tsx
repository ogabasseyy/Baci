import { formatOrderItemOptionLabel } from '@baci/shared/lib';
import { ArrowLeft, CreditCard, ShieldCheck, Truck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { CustomerOrderActions } from '@/app/(storefront)/[slug]/(customer)/account/orders/[orderId]/customer-order-actions';
import { CustomerOrderPaymentHistory } from '@/app/(storefront)/[slug]/(customer)/account/orders/[orderId]/customer-order-payment-history';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { asRoute } from '@/lib/routes';
import type { StorefrontOrder } from '@/types/storefront-order';

interface CustomerOrderDetailsContentProps {
  order: StorefrontOrder;
  basePath: string;
  merchantSlug: string;
  /**
   * Re-fetch the order view after a state change (e.g. a cancellation). The
   * page passes a refetch trigger so the server-derived `can_cancel` flag and
   * status badges stay in sync.
   */
  onOrderChanged?: () => void;
}

function formatAccountDate(value: string) {
  return new Date(value).toLocaleDateString('en-US');
}

function formatStatusLabel(status: string | null | undefined) {
  if (!status) {
    return 'Unavailable';
  }

  return status
    .split('_')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

export function CustomerOrderDetailsContent({
  order,
  basePath,
  merchantSlug,
  onOrderChanged,
}: CustomerOrderDetailsContentProps) {
  const getHref = (path: string): string => `${basePath}${path}`;
  const currency = order.currency || 'NGN';
  // Surface the merchant pickup collection point so the shopper still knows
  // where to collect even if the rate is later edited/deleted. Only
  // merchant-pickup orders (provider MERCHANT_PICKUP) carry this snapshot; ship
  // and carrier orders leave it null and render nothing.
  const pickupDetails =
    order.shipping_provider === 'MERCHANT_PICKUP'
      ? order.shipping_pickup_details
      : null;
  const pickupLabel = pickupDetails?.label?.trim() || '';
  const pickupAddressLine = pickupDetails
    ? [pickupDetails.address, pickupDetails.city, pickupDetails.state]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(', ')
    : '';
  const pickupInstructions = pickupDetails?.instructions?.trim() || '';
  const hasPickupDetails = Boolean(
    pickupLabel || pickupAddressLine || pickupInstructions
  );
  // The invoice route downloads a 325 proforma for unpaid invoice-method
  // orders: label the same document here. The href keeps the
  // current_document_kind segment (the download route is /invoice).
  const isProformaInvoice =
    order.current_document_kind !== 'receipt' &&
    order.invoice_type_code === '325';
  const documentLabel =
    order.current_document_kind === 'receipt'
      ? 'Download Receipt'
      : isProformaInvoice
        ? 'Download Proforma Invoice'
        : 'Download Invoice';
  const documentHref = `/api/storefront/account/orders/${order.id}/${order.current_document_kind}?merchantSlug=${encodeURIComponent(merchantSlug)}`;
  const firstItem = order.items[0];
  let buyAgainHref: Route | null = null;
  if (firstItem?.product_id) {
    const productPath: string = `/products/${firstItem.product_id}`;
    buyAgainHref = asRoute(getHref(productPath));
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button asChild size="icon" variant="ghost">
            <Link
              aria-label="Back to orders"
              href={asRoute(getHref('/account/orders'))}
            >
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Order #{order.order_number}</h1>
            <p className="text-sm text-muted-foreground">
              Placed on {formatAccountDate(order.created_at)}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Items</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {order.items.map((item) => {
                  const optionLabel = formatOrderItemOptionLabel({
                    condition: item.condition,
                    variantName: item.variant_name,
                  });

                  return (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-4 border-b pb-4 last:border-b-0 last:pb-0"
                    >
                      <div>
                        {item.product_id ? (
                          <Link
                            href={asRoute(
                              getHref(`/products/${item.product_id}`)
                            )}
                            className="font-medium hover:text-primary"
                          >
                            {item.product_name || item.name}
                          </Link>
                        ) : (
                          <span className="font-medium">
                            {item.product_name || item.name}
                          </span>
                        )}
                        <p className="text-sm text-muted-foreground">
                          Qty: {item.quantity}
                        </p>
                        {optionLabel && (
                          <p className="text-sm text-muted-foreground">
                            {optionLabel}
                          </p>
                        )}
                      </div>
                      <p className="text-sm font-medium">
                        {formatDisplayCurrency(item.price, currency)}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {order.items.some((item) => item.has_assurance) && (
              <Link
                href={asRoute(getHref(`/account/orders/${order.id}/insurance`))}
                className="flex items-center gap-2 rounded-md border p-4 text-sm font-medium hover:bg-muted/40"
              >
                <ShieldCheck className="size-5 text-green-600" />
                View Insurance Policy
              </Link>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Delivery & Payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex gap-3">
                  <Truck className="mt-0.5 size-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">
                      {formatStatusLabel(order.shipping_status)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {order.shipping_rate_name ||
                        order.shipping_provider ||
                        'Shipping updates will appear here'}
                    </p>
                    {hasPickupDetails && (
                      <div className="mt-2 space-y-0.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Pickup location
                        </p>
                        {pickupLabel && (
                          <p className="text-sm font-medium">{pickupLabel}</p>
                        )}
                        {pickupAddressLine && (
                          <p className="text-sm text-muted-foreground">
                            {pickupAddressLine}
                          </p>
                        )}
                        {pickupInstructions && (
                          <p className="text-sm text-muted-foreground">
                            {pickupInstructions}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-3">
                  <CreditCard className="mt-0.5 size-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">
                      {formatStatusLabel(order.payment_status)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {order.payment_method || 'Payment method unavailable'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>
                    {formatDisplayCurrency(order.subtotal || 0, currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>
                    {formatDisplayCurrency(order.shipping_fee || 0, currency)}
                  </span>
                </div>
                {typeof order.tax_amount === 'number' &&
                order.tax_amount > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span>
                      {formatDisplayCurrency(order.tax_amount, currency)}
                    </span>
                  </div>
                ) : null}
                {typeof order.discount_amount === 'number' &&
                order.discount_amount > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span>
                      -{formatDisplayCurrency(order.discount_amount, currency)}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between border-t pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span>{formatDisplayCurrency(order.total, currency)}</span>
                </div>
              </CardContent>
            </Card>

            <CustomerOrderActions
              order={order}
              documentLabel={documentLabel}
              documentHref={documentHref}
              buyAgainHref={buyAgainHref}
              onOrderChanged={onOrderChanged}
            />

            <CustomerOrderPaymentHistory
              transactions={order.transactions}
              currency={currency}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
