import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { sanitizePublicOrder } from '@/lib/public-fulfillment-sanitizer';
import {
  getCurrentDocumentKind,
  isReceiptEligible,
  normalizePaymentStatus,
  normalizeShippingStatus,
} from '@/lib/storefront-account-document-data';
import { resolveStorefrontOrderPaymentAccounts } from '@/lib/storefront-order-payment-accounts';
import { storefrontAccountDocumentQuerySchema } from '@/schemas/storefront-account-document';

interface JoinedProduct {
  slug?: string;
  category?: string | null;
  category_slug?: string | null;
  images?: unknown;
  categories?:
    | { name?: string; slug?: string }[]
    | { name?: string; slug?: string }
    | null;
}

function extractJoinedProduct(
  products: JoinedProduct | JoinedProduct[] | null | undefined
) {
  return Array.isArray(products) ? products[0] || null : products || null;
}

function extractProductImages(product: JoinedProduct | null) {
  if (!Array.isArray(product?.images)) {
    return [];
  }

  return product.images.filter(
    (image): image is string => typeof image === 'string' && image.trim() !== ''
  );
}

function normalizeImageUrl(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

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
        total,
        subtotal,
        shipping_fee,
        tax_amount,
        discount_amount,
        amount_paid,
        currency,
        external_source,
        import_job_id,
        payment_status,
        shipping_status,
        shipping_address,
        tracking_number,
        shipping_provider,
        payment_method,
        fulfillment_details,
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

    const { paymentAccountsByOrderId, paymentAccountError, transactionError } =
      await resolveStorefrontOrderPaymentAccounts(supabase, orders ?? []);
    if (paymentAccountError) {
      console.error('Orders payment-account fetch error:', paymentAccountError);
      return NextResponse.json(
        { error: 'Failed to fetch payment accounts' },
        { status: 500 }
      );
    }
    if (transactionError) {
      console.error('Orders transaction fetch error:', transactionError);
    }

    // Transform to expected format
    const transformedOrders = orders.map((order) => {
      const paymentStatus = normalizePaymentStatus(order.payment_status);
      const shippingStatus = normalizeShippingStatus(order.shipping_status);

      return {
        id: order.id,
        order_number: order.order_number,
        created_at: order.created_at,
        transaction_date: order.transaction_date,
        total: order.total,
        subtotal: order.subtotal,
        shipping_fee: order.shipping_fee,
        tax_amount: order.tax_amount,
        discount_amount: order.discount_amount,
        amount_paid: order.amount_paid,
        currency: order.currency,
        payment_status: paymentStatus,
        shipping_status: shippingStatus,
        shipping_address: order.shipping_address,
        tracking_number: order.tracking_number,
        shipping_provider: order.shipping_provider,
        payment_method: order.payment_method,
        fulfillment_details: order.fulfillment_details,
        virtual_account: paymentAccountsByOrderId.get(order.id) ?? null,
        balance: Math.max(
          0,
          Number(order.total || 0) - Number(order.amount_paid || 0)
        ),
        current_document_kind: getCurrentDocumentKind({
          paymentStatus,
          shippingStatus,
          externalSource: order.external_source,
          importJobId: order.import_job_id,
        }),
        receipt_eligible: isReceiptEligible({
          paymentStatus,
          shippingStatus,
          externalSource: order.external_source,
          importJobId: order.import_job_id,
        }),
        items: (order.order_items || []).map((item) => {
          const product = extractJoinedProduct(item.products);
          const productImages = extractProductImages(product);
          const itemImageUrl =
            normalizeImageUrl(item.image_url) || productImages[0] || undefined;
          const primaryCategory = Array.isArray(product?.categories)
            ? product.categories[0] || null
            : product?.categories || null;

          return {
            id: item.id,
            product_id: item.product_id,
            image_url: itemImageUrl,
            product_images:
              productImages.length > 0 ? productImages : undefined,
            name: item.name,
            condition: item.condition,
            variant_name: item.variant_name,
            quantity: item.quantity,
            price: item.price,
            has_assurance: item.has_assurance,
            product_slug: product?.slug,
            category: product?.category,
            category_slug: primaryCategory?.slug,
            categories: primaryCategory,
          };
        }),
      };
    });

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
