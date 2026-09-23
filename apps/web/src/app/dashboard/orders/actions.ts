'use server';

import {
  AGENTIC_ORDER_SOURCE,
  AGENTIC_ORDER_SOURCE_FILTER,
  type AgenticOrderSourceFilter,
} from '@/app/dashboard/orders/agentic-order-source';
import type { OrderFinancialFields } from '@/app/dashboard/orders/order-financials';
import { loadOrderItemImageMap } from '@/app/dashboard/orders/order-item-images';
import type {
  PaymentStatus,
  ShippingStatus,
} from '@/app/dashboard/orders/order-statuses';
import type { StaffAccess } from '@/hooks/merchant';
import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from '@/lib/email-templates';
import { formatPersonName } from '@/lib/format-person-name';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { logger } from '@/lib/logger';
import { ensurePermission } from '@/lib/merchant-server';
import { ORDER_WITH_ITEMS_QUERY } from '@/lib/order-queries';
import { sanitizeLikePattern, sanitizeSearchQuery } from '@/lib/sanitize-core';
import type { MerchantPickupAddress } from '@/lib/shipping/merchant-rates/types';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/zeptomail';
import {
  GetOrderInputSchema,
  GetOrderStatsInputSchema,
  GetOrdersInputSchema,
  ResendOrderConfirmationInputSchema,
} from '@/schemas/dashboard-order-actions';
import {
  type DashboardOrderRecord,
  mapDashboardOrderRecord,
} from './order-record-mapper';

export type { PaymentStatus, ShippingStatus } from './order-statuses';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface Transaction {
  id: string;
  reference?: string;
  gateway_reference?: string;
  status: string;
  amount: number;
  currency: string;
  gateway: string;
  created_at: string;
}

export interface Order extends OrderFinancialFields {
  id: string;
  orderNumber: string;
  customerName: string;
  total: number;
  currency: string;
  shippingStatus: ShippingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  date: string;
  createdAt: number;
  source: string;
  /** Jumia provider shop id, retained so multi-shop orders resolve their own integration. */
  jumiaShopId?: string;
  tracking_number?: string;
  shipping_provider?: string;
  delivery_method?: string | null;
  airport_type?: string | null;
  shipping_rate_id?: string;
  shipping_rate_name?: string;
  /**
   * Durable snapshot of a merchant PICKUP rate's collection point captured at
   * purchase. Present only for merchant-pickup orders (provider
   * `MERCHANT_PICKUP`); null otherwise. Lets the merchant still see the pickup
   * point even after the rate is edited or deleted.
   */
  shipping_pickup_details?: MerchantPickupAddress | null;
  payment_reference?: string;
  customer_email?: string;
  customer_phone?: string;
  notes?: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    price: number;
    image?: string;
    variant?: string;
    hasAssurance?: boolean;
  }>;
  transactions?: Transaction[];
}

export interface OrderStats {
  totalOrders: number;
  completedOrders: number;
  unpaidOrders: number;
  urgentOrders: number;
}

interface OrderFilters {
  paymentStatus?: PaymentStatus | 'All';
  shippingStatus?: ShippingStatus | 'All';
  search?: string;
  source?: AgenticOrderSourceFilter;
}

interface OrderConfirmationRecord {
  id: string;
  merchant_id: string;
  customer_id?: string | null;
  order_number: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  subtotal?: string;
  shipping_fee?: string;
  total: string;
  currency?: string | null;
  shipping_address?: {
    address?: string;
    city?: string;
    state?: string;
  };
  order_items?: Array<{
    name?: string;
    quantity?: number;
    price?: string | number;
  }>;
}

export interface JumiaOrderItem {
  id?: string;
  name?: string;
  price?: string | number;
  image_url?: string;
}

export interface JumiaOrder {
  jumia_order_id: string;
  jumia_order_number: string;
  jumia_shop_id: string | null;
  customer_name: string | null;
  total_amount: string;
  status: string;
  created_at_jumia: string;
  items?: JumiaOrderItem[];
}

const ORDER_CONFIRMATION_SELECT = [
  'id',
  'merchant_id',
  'order_number',
  'customer_name',
  'customer_email',
  'customer_phone',
  'subtotal',
  'shipping_fee',
  'total',
  'currency',
  'shipping_address',
  'order_items(id, image_url, name, quantity, price)',
].join(', ');

// The single order-details read additionally surfaces which merchant-configured
// shipping rate a shopper bought. These two columns are intentionally NOT in the
// shared ORDER_WITH_ITEMS_QUERY (which also feeds carrier/email/invoice reads);
// append them only here so fulfillment can name the pickup location / zone /
// tier instead of the bare `MERCHANT` provider label.
const ORDER_DETAILS_QUERY = `${ORDER_WITH_ITEMS_QUERY}, shipping_rate_id, shipping_rate_name, shipping_pickup_details, import_metadata`;

function getZeroOrderStats(): OrderStats {
  return {
    totalOrders: 0,
    completedOrders: 0,
    unpaidOrders: 0,
    urgentOrders: 0,
  };
}

function canAccessOrders(staffAccess: StaffAccess, action: 'view' | 'edit') {
  const permissions = staffAccess.permissions;

  return (
    staffAccess.isOwner ||
    permissions?.full_access?.all === true ||
    permissions?.orders?.all === true ||
    permissions?.['*']?.['*'] === true ||
    permissions?.['*']?.[action] === true ||
    permissions?.orders?.['*'] === true ||
    permissions?.orders?.[action] === true
  );
}

async function getAuthorizedOrderMerchantId(
  supabase: SupabaseServerClient,
  userId: string,
  requestedMerchantId: string,
  action: 'view' | 'edit'
) {
  const merchantContext = await getMerchantForApiRequest(supabase, userId, {
    requestedMerchantId,
  });

  if (
    !merchantContext ||
    !canAccessOrders(merchantContext.staffAccess, action)
  ) {
    return null;
  }

  return merchantContext.merchantId;
}

function isActiveFilter<T extends string>(
  value: T | 'All' | undefined
): value is T {
  return Boolean(value && value !== 'All');
}

export async function getOrders(
  merchantId: string,
  filters: OrderFilters = {}
): Promise<Order[]> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return [];
  }

  const input = GetOrdersInputSchema.safeParse({ merchantId, filters });
  if (!input.success) {
    return [];
  }
  const validatedMerchantId = input.data.merchantId;
  const validatedFilters = input.data.filters;

  const authorizedMerchantId = await getAuthorizedOrderMerchantId(
    supabase,
    user.id,
    validatedMerchantId,
    'view'
  );

  if (!authorizedMerchantId) {
    return [];
  }

  const paymentStatusFilter = validatedFilters.paymentStatus;
  const shippingStatusFilter = validatedFilters.shippingStatus;
  const hasPaymentFilter = isActiveFilter(paymentStatusFilter);
  const hasShippingFilter = isActiveFilter(shippingStatusFilter);
  const hasAgenticSourceFilter =
    validatedFilters.source === AGENTIC_ORDER_SOURCE_FILTER;
  const searchTerm = validatedFilters.search?.trim();
  const sanitizedSearch = searchTerm
    ? sanitizeLikePattern(sanitizeSearchQuery(searchTerm))
    : null;

  let query = supabase
    .from('orders')
    .select(`${ORDER_WITH_ITEMS_QUERY}, import_metadata`)
    .eq('merchant_id', authorizedMerchantId)
    .order('created_at', { ascending: false });

  // Apply filters
  if (hasPaymentFilter) {
    query = query.eq(
      'payment_status',
      paymentStatusFilter.toLowerCase().replace(/\s+/g, '_')
    );
  }

  if (hasShippingFilter) {
    query = query.eq('shipping_status', shippingStatusFilter.toLowerCase());
  }

  if (hasAgenticSourceFilter) {
    query = query.eq('source', AGENTIC_ORDER_SOURCE);
  }

  // Search by customer name or order number
  if (sanitizedSearch) {
    query = query.or(
      `customer_name.ilike.%${sanitizedSearch}%,order_number.ilike.%${sanitizedSearch}%`
    );
  }

  const { data: ordersData, error } = await query;

  if (error) {
    logger.error({
      message: 'Error fetching dashboard orders',
      error,
      merchantId: authorizedMerchantId,
      filters: validatedFilters,
      route: 'dashboard/orders/getOrders',
    });
    throw new Error('Failed to fetch dashboard orders');
  }

  // FETCH JUMIA ORDERS (If no specific payment/shipping filter that excludes them)
  // Jumia orders don't have standard payment/shipping statuses in the same way,
  // but we map them.
  let jumiaOrders: JumiaOrder[] = [];
  if (!hasPaymentFilter && !hasShippingFilter && !hasAgenticSourceFilter) {
    let jumiaQuery = supabase
      .from('jumia_orders')
      .select(
        'status, jumia_order_id, jumia_order_number, jumia_shop_id, customer_name, total_amount, created_at_jumia, items'
      )
      .eq('merchant_id', authorizedMerchantId)
      .is('baci_order_id', null);
    if (sanitizedSearch) {
      jumiaQuery = jumiaQuery.or(
        `customer_name.ilike.%${sanitizedSearch}%,jumia_order_number.ilike.%${sanitizedSearch}%`
      );
    }
    const { data: jOrders, error: jumiaOrdersError } = await jumiaQuery.order(
      'created_at_jumia',
      { ascending: false }
    );
    if (jumiaOrdersError) {
      logger.error({
        message: 'Error fetching legacy Jumia orders',
        error: jumiaOrdersError,
        merchantId: authorizedMerchantId,
        route: 'dashboard/orders/getOrders',
      });
    } else {
      jumiaOrders = jOrders || [];
    }
  }

  const orders = (ordersData || []) as unknown as DashboardOrderRecord[];

  const orderItemImageMap = await loadOrderItemImageMap(
    supabase,
    orders.flatMap((order) =>
      (order.order_items || []).map((item) => item.product_id)
    )
  );

  const realOrders = orders.map((order) =>
    mapDashboardOrderRecord(order, { orderItemImageMap })
  );

  // Normalize Jumia Orders
  const normalizedJumiaOrders = jumiaOrders.map((jOrder) => {
    // Basic mapping of Jumia Status to Internal Status
    // Jumia: pending, shipped, delivered, canceled, failed
    let shippingStatus: ShippingStatus = 'Pending';
    let paymentStatus: PaymentStatus = 'Paid'; // Assumed paid to Jumia

    const startStatus = jOrder.status.toLowerCase();
    if (startStatus.includes('shipped')) shippingStatus = 'Shipped';
    if (startStatus.includes('delivered')) shippingStatus = 'Delivered';
    if (startStatus.includes('cancel')) {
      shippingStatus = 'Canceled';
      paymentStatus = 'Refunded';
    }
    if (startStatus.includes('fail')) shippingStatus = 'Canceled';

    return {
      id: jOrder.jumia_order_id, // Use Jumia ID as ID
      orderNumber: jOrder.jumia_order_number,
      jumiaShopId: jOrder.jumia_shop_id ?? undefined,
      customerName: formatPersonName(jOrder.customer_name || 'Jumia Customer'),
      total: Number.parseFloat(jOrder.total_amount),
      currency: 'NGN',
      shippingStatus,
      paymentStatus,
      paymentMethod: 'Jumia Payout',
      date: new Date(jOrder.created_at_jumia).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      createdAt: new Date(jOrder.created_at_jumia).getTime(),
      source: 'jumia',
      tracking_number: undefined,
      shipping_provider: 'Jumia Services',
      items: (jOrder.items || []).map((item: JumiaOrderItem, idx: number) => ({
        id: item.id || `jumia-item-${idx}`,
        name: item.name || 'Jumia Item',
        quantity: 1, // Usually Jumia lines are qty 1 per object in older APIs, check actual data structure.
        // For now assuming 1 if not specified.
        price: Number(item.price || 0),
        image: item.image_url,
        variant: undefined,
      })),
    } as Order;
  });

  // Merge and Sort
  const allOrders = [...realOrders, ...normalizedJumiaOrders].sort(
    (a, b) => b.createdAt - a.createdAt
  );

  return allOrders;
}

export async function getOrderStats(merchantId: string): Promise<OrderStats> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return getZeroOrderStats();
  }

  const input = GetOrderStatsInputSchema.safeParse({ merchantId });
  if (!input.success) {
    return getZeroOrderStats();
  }

  const authorizedMerchantId = await getAuthorizedOrderMerchantId(
    supabase,
    user.id,
    input.data.merchantId,
    'view'
  );

  if (!authorizedMerchantId) {
    return getZeroOrderStats();
  }

  // Fetch all order counts concurrently for stats calculation
  // PERFORMANCE: Use .select('id', { count: 'exact', head: true }) instead of fetching all rows
  // to avoid large memory allocations and slow responses for merchants with many orders
  const [
    { count: totalOrders, error: totalError },
    { count: completedOrders, error: completedError },
    { count: unpaidOrders, error: unpaidError },
    { count: urgentOrders, error: urgentError },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', authorizedMerchantId),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', authorizedMerchantId)
      .eq('shipping_status', 'delivered'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', authorizedMerchantId)
      .eq('payment_status', 'unpaid'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', authorizedMerchantId)
      .or('payment_status.eq.unpaid,shipping_status.eq.pending'),
  ]);

  if (totalError || completedError || unpaidError || urgentError) {
    console.error(
      'Error fetching order stats counts:',
      totalError || completedError || unpaidError || urgentError
    );
    return getZeroOrderStats();
  }

  return {
    totalOrders: totalOrders || 0,
    completedOrders: completedOrders || 0,
    unpaidOrders: unpaidOrders || 0,
    urgentOrders: urgentOrders || 0,
  };
}

export async function getOrder(
  merchantId: string,
  orderIdentifier: string
): Promise<Order | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const input = GetOrderInputSchema.safeParse({ merchantId, orderIdentifier });
  if (!input.success) {
    return null;
  }
  const validatedMerchantId = input.data.merchantId;
  const validatedOrderIdentifier = input.data.orderIdentifier;

  const authorizedMerchantId = await getAuthorizedOrderMerchantId(
    supabase,
    user.id,
    validatedMerchantId,
    'view'
  );

  if (!authorizedMerchantId) {
    return null;
  }

  // Check if identifier is UUID
  const isUuid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      validatedOrderIdentifier
    );

  let order: DashboardOrderRecord | null = null;
  let orderError: { message?: string } | null = null;

  if (isUuid) {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_DETAILS_QUERY)
      .eq('merchant_id', authorizedMerchantId)
      .eq('id', validatedOrderIdentifier)
      .maybeSingle();

    order = data as DashboardOrderRecord | null;
    orderError = error;
  } else {
    const normalizedIdentifier = validatedOrderIdentifier
      .replace(/^#/, '')
      .trim();
    const candidateOrderNumbers = [
      normalizedIdentifier,
      `#${normalizedIdentifier}`,
    ].filter((value, index, values) => values.indexOf(value) === index);

    for (const candidateOrderNumber of candidateOrderNumbers) {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_DETAILS_QUERY)
        .eq('merchant_id', authorizedMerchantId)
        .eq('order_number', candidateOrderNumber)
        .maybeSingle();

      if (error) {
        orderError = error;
        break;
      }

      if (data) {
        order = data as DashboardOrderRecord;
        break;
      }
    }
  }

  if (orderError || !order) {
    if (orderError) {
      logger.error({
        message: 'Error fetching order',
        error: orderError,
        merchantId: authorizedMerchantId,
        requestedMerchantId: validatedMerchantId,
        orderIdentifier: validatedOrderIdentifier,
        route: 'dashboard/orders/getOrder',
      });
    }
    return null;
  }

  const orderItemImageMap = await loadOrderItemImageMap(
    supabase,
    (order.order_items || []).map((item) => item.product_id)
  );

  // Fetch transactions
  const { data: transactions } = await supabase
    .from('transactions')
    .select(
      'id, gateway_reference, status, amount, currency, gateway, created_at'
    )
    .eq('order_id', order.id)
    .order('created_at', { ascending: false });

  return mapDashboardOrderRecord(order, {
    includeDetails: true,
    orderItemImageMap,
    transactions: (transactions || []) as Transaction[],
  });
}

export async function resendOrderConfirmation(
  orderId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, message: 'Unauthorized' };
    }

    const input = ResendOrderConfirmationInputSchema.safeParse({ orderId });
    if (!input.success) {
      return { success: false, message: 'Invalid order ID' };
    }
    const validatedOrderId = input.data.orderId;

    const { merchant: authorizedMerchant } = await ensurePermission(
      'orders',
      'edit'
    );
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select(
        'id, business_name, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number'
      )
      .eq('id', authorizedMerchant.id)
      .single();

    if (merchantError || !merchant) {
      logger.error({
        message: 'Resend Notification: Merchant not found',
        merchantId: authorizedMerchant.id,
        error: merchantError,
      });
      return { success: false, message: 'Merchant profile not found' };
    }

    // 2. Fetch Order with merchant scope
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select(ORDER_CONFIRMATION_SELECT)
      .eq('id', validatedOrderId)
      .eq('merchant_id', merchant.id)
      .single();
    const order = orderData as unknown as OrderConfirmationRecord | null;

    if (orderError || !order) {
      logger.error({
        message: 'Resend Notification: Order not found',
        orderId: validatedOrderId,
        merchantId: merchant.id,
        error: orderError,
      });
      return { success: false, message: 'Order not found' };
    }

    if (!order.customer_email) {
      return { success: false, message: 'Customer has no email address' };
    }

    // 3. Prepare Email Data
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
    const merchantUrl = `https://${merchant.slug}.${rootDomain}`;

    const emailItems = (order.order_items || []).map((item) => ({
      name: item.name || 'Product',
      quantity: item.quantity || 1,
      price: Number.parseFloat(String(item.price || 0)),
    }));

    const emailData = {
      orderNumber: order.order_number || order.id.slice(0, 8).toUpperCase(),
      customerName: formatPersonName(order.customer_name || 'Customer'),
      items: emailItems,
      subtotal: Number.parseFloat(order.subtotal || '0'),
      shippingFee: Number.parseFloat(order.shipping_fee || '0'),
      total: Number.parseFloat(order.total || '0'),
      currency: order.currency || 'NGN',
      shippingAddress: {
        address: order.shipping_address?.address || '',
        city: order.shipping_address?.city || '',
        state: order.shipping_address?.state || '',
        phone: order.customer_phone || '',
      },
      merchantName: merchant.business_name,
      merchantUrl,
      merchantTin: merchant.tax_identification_number ?? undefined,
      merchantRcNumber: merchant.cac_rc_number ?? undefined,
    };

    const htmlContent = generateOrderConfirmationEmail(emailData);
    const textContent = generateOrderConfirmationText(emailData);

    // 4. Send Email
    const replyToEmail =
      merchant.support_email ||
      merchant.email ||
      `support@${merchant.slug}.${rootDomain}`;

    const senderName = merchant.email_sender_name
      ? `${merchant.email_sender_name} Orders`
      : merchant.business_name
        ? `${merchant.business_name} Orders`
        : undefined;

    await sendEmail({
      to: order.customer_email,
      toName: formatPersonName(order.customer_name || 'Customer'),
      subject: `Order Confirmation - #${emailData.orderNumber}`,
      htmlContent,
      textContent,
      replyTo: replyToEmail,
      emailType: 'orders',
      fromName: senderName,
      auditContext: {
        merchantId: merchant.id,
        orderId: order.id,
        customerId: order.customer_id,
        metadata: {
          trigger: 'manual_resend_order_confirmation',
        },
      },
    });

    logger.info({
      message: 'Order confirmation email resent manually',
      orderId: order.id,
      merchantId: merchant.id,
    });

    return {
      success: true,
      message: 'Order confirmation email sent successfully',
    };
  } catch (error) {
    logger.error({ message: 'Resend Notification: System error', error });
    return {
      success: false,
      message: 'Failed to send email. Please try again.',
    };
  }
}
