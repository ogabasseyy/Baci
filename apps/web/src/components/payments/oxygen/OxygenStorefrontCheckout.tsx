import {
  sumActiveSavingsLedgerCredit,
  summarizeWalletLedgerCredit,
} from '@baci/shared/lib';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import { CheckoutStepCard } from '@/components/storefront/ogabassey/pages/checkout/components/CheckoutStepCard';
import { CheckoutPage } from '@/components/storefront/ogabassey/pages/checkout-page';
import { readOxygenCustomerPrefill } from '@/lib/payments/oxygen/customer-prefill';
import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';
import { createClient } from '@/lib/supabase/server';
import {
  getOxygenOrderNetPayable,
  isOxygenPreGatewayStatus,
  oxygenCheckoutOrderSchema,
} from '@/schemas/oxygen-checkout-order';
import { oxygenCustomerPrefillSchema } from '@/schemas/oxygen-customer-prefill';
import { OxygenApplicationDialog } from './OxygenApplicationDialog';
import { OxygenMobileOrderSummary } from './OxygenMobileOrderSummary';
import { OxygenRecoverySignIn } from './OxygenRecoverySignIn';
import { OxygenSavedOrderSummary } from './OxygenSavedOrderSummary';
import {
  ownsOxygenCheckoutOrder,
  readOwnedOxygenCustomerId,
} from './oxygen-checkout-ownership';
import { oxygenOrderItemImage } from './oxygen-order-item-image';

/** Resume the owned, persisted order inside the existing storefront checkout. */
export async function OxygenStorefrontCheckout({
  orderId,
  merchantId,
  merchantSlug,
}: {
  orderId: string;
  merchantId: string;
  merchantSlug: string;
}) {
  const client = await createClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError && (!isAuthSessionMissingError(authError) || user)) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <p role="alert">We couldn’t confirm your sign-in. Please try again.</p>
        <a
          href={`/${encodeURIComponent(merchantSlug)}/checkout?oxygenOrderId=${encodeURIComponent(orderId)}`}
        >
          Try again
        </a>
      </main>
    );
  }
  if (!user) return <OxygenRecoverySignIn merchantSlug={merchantSlug} />;
  const { selfie: selfieOrigins, hosted: hostedOrigins } =
    readOxygenHostedOrigins();
  const customerId = await readOwnedOxygenCustomerId(
    client,
    orderId,
    merchantId,
    user.id
  );
  if (!customerId) notFound();
  const { data, error } = await client
    .from('orders')
    .select(
      'id, merchant_id, customer_id, payment_method, payment_status, customers!orders_customer_id_fkey1!inner(id, merchant_id, user_id), customer_name, customer_email, currency, subtotal, shipping_fee, tax_amount, total, amount_paid, wallet_amount_used, order_items(id, name, image_url, quantity, price, products:products!order_items_product_id_fkey(images))'
    )
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .eq('payment_method', 'oxygen')
    .eq('customers.user_id', user.id)
    .maybeSingle();
  const parsed = oxygenCheckoutOrderSchema.safeParse(data);
  if (
    error ||
    !ownsOxygenCheckoutOrder(data, orderId, merchantId, customerId, user.id) ||
    !parsed.success
  )
    notFound();
  const [
    { data: walletLedgerRows, error: walletLedgerError },
    { data: savingsLedgerRows, error: savingsLedgerError },
    prefill,
  ] = await Promise.all([
    client
      .from('customer_wallet_transactions')
      .select('amount, status, source_type, type')
      .eq('source_id', orderId)
      .eq('customer_id', customerId)
      .eq('merchant_id', merchantId),
    client
      .from('customer_savings_redemptions')
      .select('amount, metadata')
      .eq('order_id', orderId)
      .eq('customer_id', customerId)
      .eq('merchant_id', merchantId),
    readOxygenCustomerPrefill(client, orderId, user.id),
  ]);
  if (walletLedgerError || savingsLedgerError) notFound();
  const walletLedgerSummary = summarizeWalletLedgerCredit(walletLedgerRows);
  const order = {
    ...parsed.data,
    wallet_ledger_used: walletLedgerSummary.netCredit,
    wallet_reversal_completed: walletLedgerSummary.hasCompletedReversal,
    wallet_reversed_credit: walletLedgerSummary.reversedCredit,
    savings_ledger_used: sumActiveSavingsLedgerCredit(savingsLedgerRows),
  };
  const netPayable = getOxygenOrderNetPayable(order);
  const isZeroDuePreGateway =
    isOxygenPreGatewayStatus(order.payment_status) && netPayable <= 0;
  const names = order.customer_name?.trim().split(/\s+/) ?? [];
  const checkoutContact = oxygenCustomerPrefillSchema.safeParse({
    ...prefill,
    ...(names.length >= 2
      ? { first_name: names[0], last_name: names.slice(1).join(' ') }
      : {}),
    ...(order.customer_email ? { email: order.customer_email } : {}),
  });
  const contact = checkoutContact.success ? checkoutContact.data : prefill;
  return (
    <CheckoutPage
      verifiedOxygenOrderId={order.id}
      oxygenStep={
        <>
          <CheckoutStepCard
            number={1}
            title="Contact Information"
            complete
            summary={`${order.customer_name ?? ''} · ${order.customer_email ?? ''}`}
          />
          <CheckoutStepCard
            number={2}
            title="Delivery Method"
            complete
            summary="Delivery selection saved with this order"
          />
          <CheckoutStepCard number={3} title="Payment Method" active>
            {isZeroDuePreGateway ? (
              <p className="text-sm text-muted-foreground">
                This order is fully covered by store credit. No financing or
                additional payment is required.
              </p>
            ) : (
              <OxygenApplicationDialog
                orderId={orderId}
                merchantSlug={merchantSlug}
                selfieOrigins={selfieOrigins}
                hostedOrigins={hostedOrigins}
                prefill={contact}
                productAmount={netPayable}
                products={order.order_items.map((item) => ({
                  ...item,
                  imageUrl: oxygenOrderItemImage(item),
                }))}
                currency={order.currency}
              />
            )}
          </CheckoutStepCard>
        </>
      }
      oxygenSummary={<OxygenSavedOrderSummary order={order} />}
      oxygenMobileSummary={<OxygenMobileOrderSummary order={order} />}
    />
  );
}
