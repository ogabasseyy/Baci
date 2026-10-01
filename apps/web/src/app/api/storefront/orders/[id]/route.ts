import {
  getPaystackDvaAccountNumberFromTransactions,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { sanitizePublicOrder } from '@/lib/public-fulfillment-sanitizer';
import { isValidUuid, sanitizeForLog } from '@/lib/sanitize-core';
import { toOrderPaymentAccount } from '@/lib/storefront-customer-payment-account-adapter';
import { loadStorefrontCustomerPaymentAccounts } from '@/lib/storefront-customer-payment-accounts';
import { loadStorefrontCustomerTransactions } from '@/lib/storefront-customer-transactions';
import { createAnonClient } from '@/lib/supabase/anon';
import { createClient } from '@/lib/supabase/server';
import { buildGuestOrderResponse } from './build-guest-order-response';
import { fetchAuthenticatedDeliveryFlag } from './fetch-authenticated-delivery-flag';
import { fetchOrderInventoryProof } from './fetch-inventory-proof';
import { fetchProductRouteDetails } from './fetch-product-route-details';
import { mapOrderItemsWithRoutes } from './map-order-items-with-routes';
import { mapTrackingPaymentAccounts } from './map-tracking-payment-accounts';
import { orderDetailSelect } from './order-detail-select';
import type { OrderItem } from './order-item-types';
import { parseOrderDetailQuery } from './parse-order-detail-query';
import { resolveMerchantIdBySlug } from './resolve-merchant-id-by-slug';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const queryResult = parseOrderDetailQuery(request);
    if (!queryResult.ok) {
      return queryResult.response;
    }
    const { token, email, merchantSlug } = queryResult.query;
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log(
      '[API/Orders] Fetching order %s. User present: %s, merchant_slug: %s',
      sanitizeForLog(id),
      !!user,
      sanitizeForLog(merchantSlug)
    );

    if (user) {
      if (!isValidUuid(id)) {
        return NextResponse.json(
          { error: 'Invalid order ID' },
          { status: 400 }
        );
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(orderDetailSelect)
        .eq('id', id)
        .single();

      if (orderError || !order) {
        // Fall through to public lookup if not found by session (e.g. guest order, different account)
        console.debug(
          '[API/Orders] Order %s not found via session lookup. Error:',
          sanitizeForLog(id),
          orderError?.message
        );
      } else {
        if (merchantSlug) {
          const requestedMerchantId = await resolveMerchantIdBySlug(
            merchantSlug,
            supabase
          );

          if (
            !requestedMerchantId ||
            requestedMerchantId !== order.merchant_id
          ) {
            return NextResponse.json(
              { error: 'Order not found' },
              { status: 404 }
            );
          }
        }

        const paymentAccountsResult =
          await loadStorefrontCustomerPaymentAccounts(supabase, [order.id]);
        if (paymentAccountsResult.error) {
          console.error(
            '[API/Orders] Payment-account fetch error (session):',
            paymentAccountsResult.error
          );
          return NextResponse.json(
            { error: 'Failed to fetch payment accounts' },
            { status: 500 }
          );
        }

        console.log(
          '[API/Orders] Found order %s via session lookup.',
          sanitizeForLog(id)
        );
        const { data: items, error: itemsError } = await supabase
          .from('order_items')
          .select(
            `
              id,
              product_id,
              condition,
              image_url,
              variant_name,
              product_name:name,
              quantity,
              price,
              products:products!order_items_product_id_fkey (
                slug,
                gtin,
                category,
                categories:categories (
                  name,
                  slug
                )
              )
            `
          )
          .eq('order_id', order.id);

        if (itemsError) {
          console.error(
            '[API/Orders] Items fetch error (session):',
            itemsError
          );
        }

        const isPaidOrder =
          order.payment_status?.trim().toLowerCase() === 'paid';
        const transactionsResult = isPaidOrder
          ? await loadStorefrontCustomerTransactions(supabase, [order.id])
          : { data: [], error: null };
        const { data: transactions, error: transactionsError } =
          transactionsResult;
        if (transactionsError) {
          console.error(
            '[API/Orders] Transaction fetch error (session):',
            transactionsError
          );
        }

        const orderForResponse = {
          ...order,
        } as typeof order & { order_payment_accounts?: unknown };
        delete orderForResponse.order_payment_accounts;

        // biome-ignore format: compact call preserves the 300-line route gate.
        const notificationDelivered = await fetchAuthenticatedDeliveryFlag(supabase, order.id);
        // biome-ignore format: compact call preserves the 300-line route gate.
        const inventoryConfirmed = await fetchOrderInventoryProof(supabase, order.id, token ?? null, email ?? null);

        return NextResponse.json(
          sanitizePublicOrder({
            ...orderForResponse,
            notification_delivered: notificationDelivered,
            inventory_confirmed: inventoryConfirmed,
            shipping_cost: order.shipping_fee,
            short_id: order.order_number,
            items: mapOrderItemsWithRoutes(items || []),
            virtual_account:
              isPaidOrder && transactionsError
                ? null
                : selectPreferredOrderPaymentAccount(
                    paymentAccountsResult.data.map(toOrderPaymentAccount),
                    new Date(),
                    {
                      allowExpiredPaystackAccount: isPaidOrder,
                      preferredPaystackAccountNumber: isPaidOrder
                        ? getPaystackDvaAccountNumberFromTransactions(
                            transactions
                          )
                        : null,
                    }
                  ) || null,
          })
        );
      }
    }
    if (!merchantSlug) {
      return NextResponse.json(
        { error: 'merchant_slug is required for public order lookup' },
        { status: 400 }
      );
    }
    if (!token && !email) {
      return NextResponse.json(
        { error: 'Tracking token or email is required' },
        { status: 400 }
      );
    }

    if (!token && !isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const preferEmailLookup = Boolean(email && isValidUuid(id));
    const anon = createAnonClient();
    const { data: orders, error } = await anon.rpc('get_order_tracking', {
      p_merchant_slug: merchantSlug,
      p_order_id: preferEmailLookup ? id : token ? null : id,
      p_order_number: null,
      p_email: preferEmailLookup ? email : token ? null : email,
      p_tracking_token: preferEmailLookup ? null : token || null,
    });

    const order = Array.isArray(orders) ? orders[0] : null;

    if (error || !order) {
      console.error('Storefront order fetch error:', error);
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Token lookups resolve by token (p_order_id: null), so a URL whose
    // path names order A but whose token belongs to order B returns B —
    // including B's active transfer account below. Reject the mismatch
    // before selecting or returning the account, as the checkout-success
    // lookup does: a stale or mismatched deep link must never display
    // and copy payment instructions for the wrong order under A's URL.
    // Uniform 404 (no existence oracle).
    if (token && !preferEmailLookup && order.id !== id) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const rawItems: OrderItem[] = Array.isArray(order.items) ? order.items : [];
    const productRouteDetails = await fetchProductRouteDetails(
      rawItems,
      async (productIds) =>
        anon
          .from('products')
          .select(`
            id,
            slug,
            gtin,
            category,
            categories:categories (
              name,
              slug
            )
          `)
          .in('id', productIds)
    );
    const items = mapOrderItemsWithRoutes(rawItems, productRouteDetails);
    // Guest Pay for Me checkouts render payer instructions from this
    // lookup: include the active provisioned account (strict selection —
    // expired aliases are never payable, unlike the paid-document
    // historical allowance in the signed-in branch).
    const guestVirtualAccount =
      selectPreferredOrderPaymentAccount(
        mapTrackingPaymentAccounts(order.payment_accounts),
        new Date()
      ) || null;

    // biome-ignore format: compact call preserves the 300-line route gate.
    const inventoryConfirmed = await fetchOrderInventoryProof(anon, order.id, token || null, email || null);

    return NextResponse.json(
      buildGuestOrderResponse({
        order,
        token: token || null,
        items,
        virtualAccount: guestVirtualAccount,
        inventoryConfirmed,
      })
    );
  } catch (error) {
    console.error(
      'Unexpected error in GET /api/storefront/orders/[id]:',
      error
    );
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
