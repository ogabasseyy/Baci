import { compareReceiptListDesc } from '@baci/shared/receipt';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { sanitizePublicOrder } from '@/lib/public-fulfillment-sanitizer';
import { resolveStorefrontOrderPaymentAccounts } from '@/lib/storefront-order-payment-accounts';
import { storefrontAccountDocumentQuerySchema } from '@/schemas/storefront-account-document';
import { transformStorefrontOrdersForDisplay } from './storefront-orders-transform';

/** Customer orders for authenticated web and mobile customers. */

export async function GET(request: NextRequest) {
  try {
    // Authenticate FIRST — before processing any user-controlled input
    const auth = await authenticateApiRequest(request);

    if (!auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { user, supabase } = auth;

    const parsedQuery = storefrontAccountDocumentQuerySchema.safeParse({
      merchantSlug: new URL(request.url).searchParams.get('merchantSlug'),
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 }
      );
    }

    const merchantSlug = parsedQuery.data.merchantSlug;

    // Get merchant
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', merchantSlug)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    // Get customer record for this merchant
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('merchant_id', merchant.id)
      .eq('user_id', user.id)
      .single();

    if (customerError || !customer) {
      // Customer exists in auth but hasn't ordered from this merchant yet
      return NextResponse.json({ orders: [] });
    }

    // Fetch orders for this customer
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        created_at,
        transaction_date,
        invoice_issue_date,
        total,
        subtotal,
        shipping_fee,
        tax_amount,
        discount_amount,
        amount_paid,
        currency,
        external_source,
        import_job_id,
        recorded_by_user_id,
        payment_status,
        shipping_status,
        shipping_address,
        tracking_number,
        shipping_provider,
        payment_method,
        invoice_type_code,
        fulfillment_details,
        customer_name,
        customer_email,
        customer_phone,
        order_items (
          id,
          name,
          product_id,
          condition,
          variant_name,
          image_url,
          quantity,
          price,
          has_assurance,
          assurance_fee,
          products:products!order_items_product_id_fkey (
            slug,
            category,
            images,
            categories:categories (
              name,
              slug
            )
          )
        )
      `)
      .eq('customer_id', customer.id)
      .eq('merchant_id', merchant.id)
      .order('transaction_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.error('Orders fetch error:', ordersError);
      return NextResponse.json(
        { error: 'Failed to fetch orders' },
        { status: 500 }
      );
    }

    const {
      paymentAccountsByOrderId,
      paymentAccountError,
      transactionError,
      transactionsByOrderId,
    } = await resolveStorefrontOrderPaymentAccounts(supabase, orders ?? []);
    if (paymentAccountError) {
      console.error('Orders payment-account fetch error:', paymentAccountError);
      return NextResponse.json(
        { error: 'Failed to fetch payment accounts' },
        { status: 500 }
      );
    }
    if (transactionError) {
      console.error('Orders transaction fetch error:', transactionError);
      return NextResponse.json(
        { error: 'Failed to fetch order transactions' },
        { status: 500 }
      );
    }

    const transformedOrders = transformStorefrontOrdersForDisplay(orders, {
      transactionsByOrderId,
      paymentAccountsByOrderId,
    });

    // Supabase cannot sort by the display-date fallback, so file backdated
    // invoices by the same issue → transaction → creation date here.
    transformedOrders.sort(compareReceiptListDesc);

    return NextResponse.json({
      orders: sanitizePublicOrder(transformedOrders),
    });
  } catch (error) {
    console.error('Orders API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
