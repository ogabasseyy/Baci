'use client';

import { CheckCircle, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';
import { ThemedButton } from '@/components/themed';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { MerchantProvider } from '@/hooks/merchant/merchant-provider';
import { useMerchant } from '@/hooks/use-merchant-client';
import { getCountryByCode } from '@/lib/countries';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { retireLegacyCheckoutRedirectWhenPaid } from '../legacy-checkout-redirect-retirement';
import {
  getLastOrderSnapshot,
  getServerLastOrderSnapshot,
  parseOrderSnapshot,
  subscribeToLastOrderSnapshot,
} from './client-page-order-snapshot';

const DEFAULT_SHIPPING_FEE = 10;
const successAccentStyles = {
  backgroundColor:
    'color-mix(in srgb, var(--store-primary, #16a34a) 12%, transparent)',
  color: 'var(--store-primary, #16a34a)',
};

export function SuccessPageContent() {
  const orderSnapshot = useSyncExternalStore(
    subscribeToLastOrderSnapshot,
    getLastOrderSnapshot,
    getServerLastOrderSnapshot
  );
  const order = parseOrderSnapshot(orderSnapshot);
  const { merchant } = useMerchant();
  const confirmedOrderId = order?.order_id;
  const confirmedEmail = order?.shipping?.email;
  const merchantSlug = merchant?.slug;

  // Retire the loyalty checkout key retained for this order once the
  // tracking endpoint confirms it is paid, so a repeated identical
  // purchase creates a fresh order. Reaching this page alone does not
  // retire anything: the snapshot exists since order creation, so an
  // abandoned gateway visit must keep the replay key.
  useEffect(() => {
    if (confirmedOrderId) {
      void retireLegacyCheckoutRedirectWhenPaid({
        orderId: confirmedOrderId,
        email: confirmedEmail,
        merchantSlug,
      });
    }
  }, [confirmedOrderId, confirmedEmail, merchantSlug]);

  const formatCurrency = (amount: number) => {
    const country = merchant?.country
      ? getCountryByCode(merchant.country)
      : undefined;
    const currency = country ? country.currency : 'USD';
    return formatDisplayCurrency(amount, currency, {
      currencyDisplay: 'symbol',
    });
  };

  const subtotal =
    order?.subtotal ??
    order?.items.reduce((acc, item) => acc + item.price * item.quantity, 0) ??
    0;
  const shippingFee = order?.shipping_fee ?? DEFAULT_SHIPPING_FEE;
  const total = order?.total ?? subtotal + shippingFee;

  return (
    <div className="container mx-auto max-w-2xl py-12 px-4">
      <Card>
        <CardHeader className="text-center">
          <div
            className="mx-auto rounded-full p-3 w-fit"
            style={successAccentStyles}
          >
            <CheckCircle className="size-12" />
          </div>
          <CardTitle className="text-3xl mt-4">Order Confirmed!</CardTitle>
          {order?.order_number && (
            <p className="text-lg font-medium text-muted-foreground mt-2">
              Order {order.order_number}
            </p>
          )}
          {order?.shipping ? (
            <p className="text-muted-foreground" data-ph-block>
              Thank you for your purchase, {order.shipping.firstName}! A
              confirmation has been sent to {order.shipping.email}.
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {order && (
            <div className="space-y-6">
              <div data-ph-block>
                <h3 className="font-semibold mb-2">Shipping To</h3>
                <p className="text-sm text-muted-foreground">
                  {order.shipping.firstName} {order.shipping.lastName}
                  <br />
                  {order.shipping.address}
                  <br />
                  {order.shipping.city}, {order.shipping.state}
                </p>
              </div>
              <Separator />
              <div>
                <h3 className="font-semibold mb-4">Order Summary</h3>
                <div className="space-y-4">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-4">
                      <Image
                        src={item.image}
                        alt={item.name}
                        width={64}
                        height={64}
                        className="rounded-md object-cover"
                      />
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Qty: {item.quantity}
                        </p>
                      </div>
                      <p className="font-medium">
                        {formatCurrency(item.price * item.quantity)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>{formatCurrency(shippingFee)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
          )}
          <div className="mt-8 text-center">
            <div className="flex flex-col items-center gap-3">
              <ThemedButton colorRole="primary" asChild>
                <Link href="/">Continue Shopping</Link>
              </ThemedButton>
              <a
                href={BACI_GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-foreground/80 hover:text-foreground"
              >
                <Star className="size-4" />
                Leave a Google Review
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <MerchantProvider>
      <SuccessPageContent />
    </MerchantProvider>
  );
}
