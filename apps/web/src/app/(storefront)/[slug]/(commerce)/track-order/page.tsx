'use client';

import {
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Package,
  Phone,
  Search,
  Truck,
  XCircle,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ThemedBadge,
  ThemedButton,
  ThemedCard,
  ThemedInput,
} from '@/components/themed';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { usePrivateSearchParams } from '@/hooks/use-private-search-params';
import { formatCurrency as formatCurrencyByCountry } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { OrderItemRow, type TrackOrderItem } from './order-item-row';

interface TimelineEvent {
  status: string;
  title: string;
  description: string;
  timestamp: string;
  icon:
    | 'order'
    | 'payment'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled';
}

interface OrderData {
  order: {
    id: string;
    order_number: string;
    status: string;
    payment_status: string;
    created_at: string;
    updated_at: string;
    subtotal: number;
    shipping_cost: number;
    discount_amount: number;
    total: number;
    currency: string;
  };
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  shipping_address: {
    address: string;
    city: string;
    state: string;
    country: string;
  };
  items: TrackOrderItem[];
  timeline: TimelineEvent[];
  shipping_tracking: {
    provider: string;
    tracking_number: string;
    tracking_url: string;
  } | null;
  estimated_delivery: {
    min: string;
    max: string;
  } | null;
  merchant: {
    name: string;
    logo?: string;
    support_email?: string;
    support_phone?: string;
  };
}

const iconMap = {
  order: Package,
  payment: CreditCard,
  processing: Clock,
  shipped: Truck,
  delivered: CheckCircle2,
  cancelled: XCircle,
};

/** Deterministic currency→country mapping for formatting. */
const PREFERRED_COUNTRY_FOR_CURRENCY: Record<string, string> = {
  NGN: 'NG',
  USD: 'US',
  GBP: 'GB',
  EUR: 'DE',
  GHS: 'GH',
  KES: 'KE',
  ZAR: 'ZA',
  XOF: 'SN',
  XAF: 'CM',
  EGP: 'EG',
};

const getCountryCodeForCurrency = (currency?: string | null) =>
  (currency ? PREFERRED_COUNTRY_FOR_CURRENCY[currency] : null) ?? 'NG';

const TERMINAL_STATUSES = new Set(['cancelled', 'failed']);

interface TrackingLookupParams {
  order_id?: string | null;
  order_number?: string | null;
  email?: string | null;
  tracking_token?: string | null;
}

type TrackingLookupResult =
  | { data: OrderData; error: null }
  | { data: null; error: string };

/**
 * Module-scope lookup keeps the try/finally and throw statements out of the
 * component body so React Compiler can memoize the page.
 */
async function fetchOrderTracking(
  merchantSlug: string | undefined,
  trackingParams: TrackingLookupParams
): Promise<TrackingLookupResult> {
  try {
    if (!merchantSlug) {
      throw new Error('Store identifier is missing.');
    }
    // Token-based lookup doesn't need email; manual form does
    if (!trackingParams.tracking_token && !trackingParams.email) {
      throw new Error('Email is required to track an order.');
    }

    const queryParams = new URLSearchParams();
    if (trackingParams.tracking_token) {
      queryParams.set('token', trackingParams.tracking_token);
    } else {
      if (trackingParams.order_id)
        queryParams.set('order_id', trackingParams.order_id);
      if (trackingParams.order_number)
        queryParams.set('order_number', trackingParams.order_number);
      if (trackingParams.email) queryParams.set('email', trackingParams.email);
    }
    queryParams.set('merchant_slug', merchantSlug);

    const response = await fetch(
      `/api/storefront/orders/track-order?${queryParams}`
    );
    let data: OrderData | { error?: string };
    try {
      data = await response.json();
    } catch {
      throw new Error('Unexpected server response. Please try again later.');
    }

    if (!response.ok) {
      const errorData = data as { error?: string };
      throw new Error(errorData.error || 'Failed to find order');
    }

    return { data: data as OrderData, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'An error occurred',
    };
  }
}

function HorizontalProgressBar({
  status,
  latestUpdate,
}: {
  status: string;
  latestUpdate: string;
}) {
  const stages = [
    { id: 'placed', label: 'Placed' },
    { id: 'processing', label: 'Processing' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'delivered', label: 'Delivered' },
  ];

  // Normalize status for comparison
  const normalizedStatus = status.toLowerCase();
  const isTerminal = TERMINAL_STATUSES.has(normalizedStatus);

  // Terminal states: show alternative UI
  if (isTerminal) {
    const label =
      normalizedStatus === 'cancelled' ? 'Order Cancelled' : 'Order Failed';
    return (
      <div className="py-8 w-full max-w-2xl mx-auto px-4">
        <output aria-label={label} className="flex flex-col items-center gap-3">
          <div className="size-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <XCircle className="size-7 text-red-500" />
          </div>
          <span className="inline-block px-4 py-1.5 rounded-full text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
            {label}
          </span>
        </output>
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground bg-gray-50 dark:bg-gray-900 inline-block px-4 py-1.5 rounded-full border border-gray-100 dark:border-gray-800">
            Latest update: {latestUpdate}
          </p>
        </div>
      </div>
    );
  }

  // Determine active index
  let activeIndex = 0;
  if (normalizedStatus === 'delivered' || normalizedStatus === 'completed')
    activeIndex = 3;
  else if (normalizedStatus === 'shipped') activeIndex = 2;
  else if (normalizedStatus === 'processing' || normalizedStatus === 'current')
    activeIndex = 1;
  else activeIndex = 0; // pending/placed

  return (
    <div className="py-8 w-full max-w-2xl mx-auto px-4">
      <div
        className="relative flex justify-between items-center"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={stages.length - 1}
        aria-valuenow={activeIndex}
        aria-label="Order progress"
      >
        {/* Progress Line Background */}
        <div className="absolute top-5 left-0 right-0 h-1 bg-gray-200 dark:bg-gray-700 -translate-y-1/2 rounded-full z-0" />

        {/* Active Progress Line */}
        <div
          className="absolute top-5 left-0 h-1 bg-store-accent -translate-y-1/2 rounded-full z-0 transition-all duration-700 ease-in-out"
          style={{ width: `${(activeIndex / (stages.length - 1)) * 100}%` }}
        />

        {stages.map((stage, index) => {
          const isCompleted = index <= activeIndex;

          return (
            <div
              key={stage.id}
              className="relative z-10 flex flex-col items-center"
            >
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-4',
                  isCompleted
                    ? 'bg-store-accent border-store-accent text-store-accent-text scale-110 shadow-lg'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-300'
                )}
              >
                {isCompleted ? (
                  <Check className="size-5 font-bold" strokeWidth={3} />
                ) : (
                  <div className="size-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                )}
              </div>
              <div className="absolute top-12 left-1/2 -translate-x-1/2 w-32 text-center pointer-events-none">
                <p
                  className={cn(
                    'text-sm font-medium transition-colors duration-300',
                    isCompleted
                      ? 'text-store-accent font-bold'
                      : 'text-muted-foreground'
                  )}
                >
                  {stage.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-16 text-center">
        <p className="text-sm text-muted-foreground bg-gray-50 dark:bg-gray-900 inline-block px-4 py-1.5 rounded-full border border-gray-100 dark:border-gray-800">
          Latest update: {latestUpdate}
        </p>
      </div>
    </div>
  );
}

export default function OrderTrackPage() {
  return <OrderTrackContent />;
}

function OrderTrackContent() {
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = usePrivateSearchParams();
  const params = useParams();
  const slugParam = params?.slug;
  const merchantSlug = Array.isArray(slugParam) ? slugParam[0] : slugParam;

  const qToken = searchParams.get('token');
  const qOrderId = searchParams.get('order_id') || searchParams.get('orderId');
  const qOrderNumber =
    searchParams.get('order_number') || searchParams.get('orderNumber');
  const qEmail = searchParams.get('email');

  // Token-based lookup (from order-success link) hides the manual form.
  // Derived from the URL instead of effect-synced state.
  const isTokenLookup = !!qToken;

  // Will the effect below auto-trigger a lookup for the current URL params?
  const willAutoFetch = !!qToken || !!((qOrderId || qOrderNumber) && qEmail);

  // Seed/reset the form fields from URL params during render with a
  // prev-compare instead of an effect (react.dev: adjusting some state when a
  // prop changes), avoiding a stale frame between commits.
  const [prevSearchKey, setPrevSearchKey] = useState<string | null>(null);
  const searchKey = searchParams.toString();
  if (searchKey !== prevSearchKey) {
    setPrevSearchKey(searchKey);

    // Clear stale state when params are absent
    if (!qEmail) setEmail('');
    if (!qOrderId) setOrderId(null);
    if (!qOrderNumber) setOrderNumber('');

    if (!qToken) {
      if (qOrderId) setOrderId(qOrderId);
      if (qEmail) setEmail(qEmail);
      if (!qOrderId && qOrderNumber && qEmail) setOrderNumber(qOrderNumber);
    }

    // Enter the loading state for URL-triggered lookups here (render-time
    // prev-compare) so the effect never sets state synchronously.
    if (willAutoFetch) {
      setLoading(true);
      setError(null);
    }
  }

  // Manual form submissions — sets the loading state in the event handler.
  const handleFetchTracking = async (trackingParams: TrackingLookupParams) => {
    setLoading(true);
    setError(null);

    const result = await fetchOrderTracking(merchantSlug, trackingParams);

    setOrderData(result.data);
    setError(result.error);
    setLoading(false);
  };

  // Automatic tracking from URL params. The loading state is entered by the
  // render-time prev-compare above; results land via the async callback.
  useEffect(() => {
    const token = searchParams.get('token');
    const orderIdParam =
      searchParams.get('order_id') || searchParams.get('orderId');
    const orderNumberParam =
      searchParams.get('order_number') || searchParams.get('orderNumber');
    const emailParam = searchParams.get('email');

    let trackingParams: TrackingLookupParams | null = null;
    if (token) {
      // Token-based lookup (from order-success link) — no email needed
      trackingParams = { tracking_token: token };
    } else if ((orderIdParam || orderNumberParam) && emailParam) {
      trackingParams = orderIdParam
        ? { order_id: orderIdParam, email: emailParam }
        : { order_number: orderNumberParam, email: emailParam };
    }
    if (!trackingParams) return;

    let cancelled = false;
    fetchOrderTracking(merchantSlug, trackingParams).then((result) => {
      if (cancelled) return;
      setOrderData(result.data);
      setError(result.error);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams, merchantSlug]);

  const handleTrackOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedOrderNumber = orderNumber.trim();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Email is required to track an order.');
      return;
    }
    if (!trimmedOrderNumber && !orderId) {
      setError('Order number is required.');
      return;
    }

    await handleFetchTracking({
      order_number: trimmedOrderNumber || null,
      order_id: trimmedOrderNumber ? null : orderId,
      email: trimmedEmail,
    });
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number, currency: string = 'NGN') =>
    formatCurrencyByCountry(amount, getCountryCodeForCurrency(currency));

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'delivered':
        return 'var(--store-primary)';
      case 'current':
      case 'processing':
      case 'shipped':
        return 'var(--store-accent)';
      case 'pending':
        return 'var(--muted)';
      case 'failed':
      case 'cancelled':
        return 'var(--destructive)';
      default:
        return 'var(--muted)';
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Track Your Order</h1>
        {!isTokenLookup && (
          <p className="text-muted-foreground">
            Enter your order number and email to track your delivery
          </p>
        )}
      </div>

      {!isTokenLookup && (
        <ThemedCard className="mb-8">
          <CardContent className="pt-6">
            <form onSubmit={handleTrackOrder} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="orderNumber"
                    className="block text-sm font-medium mb-1"
                  >
                    Order Number
                  </label>
                  <ThemedInput
                    id="orderNumber"
                    placeholder="ORD-241204-A7K3-2"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium mb-1"
                  >
                    Email Address
                  </label>
                  <ThemedInput
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <ThemedButton type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Clock className="mr-2 size-4 animate-spin" />
                    Searching…
                  </>
                ) : (
                  <>
                    <Search className="mr-2 size-4" />
                    Track Order
                  </>
                )}
              </ThemedButton>
            </form>
          </CardContent>
        </ThemedCard>
      )}

      {/* Loading indicator for token-based lookups (form is hidden) */}
      {isTokenLookup && loading && (
        <div className="flex items-center justify-center py-12">
          <Clock className="mr-2 size-5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Searching…</span>
        </div>
      )}

      {/* Error banner — always visible regardless of lookup mode */}
      {error && (
        <div
          role="alert"
          aria-atomic="true"
          className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg text-sm"
        >
          {error}
        </div>
      )}

      {orderData && (
        <div className="space-y-6">
          {/* Order Header */}
          <ThemedCard>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Placed on {formatDate(orderData.order.created_at)}
                  </p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="size-4" />
                    <span className="text-sm">via Website</span>
                  </div>
                </div>
                <div>
                  <ThemedBadge
                    variant={
                      orderData.order.status === 'cancelled'
                        ? 'destructive'
                        : 'default'
                    }
                    colorRole={
                      orderData.order.status === 'delivered'
                        ? 'primary'
                        : 'accent'
                    }
                    className="px-4 py-1.5 rounded-full text-base font-medium"
                    style={
                      orderData.order.status !== 'cancelled'
                        ? {
                            backgroundColor:
                              'color-mix(in srgb, var(--store-accent) 10%, transparent)',
                            border: 'none',
                          }
                        : undefined
                    }
                  >
                    <span
                      style={
                        orderData.order.status !== 'cancelled'
                          ? { color: 'var(--store-accent)' }
                          : undefined
                      }
                    >
                      {orderData.order.status.charAt(0).toUpperCase() +
                        orderData.order.status.slice(1)}
                    </span>
                  </ThemedBadge>
                </div>
              </div>

              <HorizontalProgressBar
                status={orderData.order.status}
                latestUpdate={formatDate(
                  [...orderData.timeline]
                    .reverse()
                    .find((event) => event.timestamp)?.timestamp ||
                    orderData.order.updated_at ||
                    orderData.order.created_at
                )}
              />

              <Separator className="my-6" />

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-lg">
                    Order {orderData.order.order_number}
                  </h3>
                </div>
                {orderData.estimated_delivery && (
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      Estimated Delivery
                    </p>
                    <p className="font-medium">
                      {new Date(
                        orderData.estimated_delivery.min
                      ).toLocaleDateString('en-NG', {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      -{' '}
                      {new Date(
                        orderData.estimated_delivery.max
                      ).toLocaleDateString('en-NG', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </ThemedCard>

          {/* Timeline */}
          <ThemedCard>
            <CardHeader>
              <CardTitle>Order Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                {orderData.timeline.map((event, index) => {
                  const Icon = iconMap[event.icon];
                  const color = getStatusColor(event.status);
                  const isPending = event.status === 'pending';
                  const isCurrent =
                    event.status === 'current' ||
                    event.status === 'processing' ||
                    event.status === 'shipped';

                  // Use composite key: timestamp+title is stable and unique
                  const stableKey = event.timestamp
                    ? `${event.timestamp}-${event.title}`
                    : `${event.title}-${index}`;
                  return (
                    <div key={stableKey} className="flex gap-4 pb-8 last:pb-0">
                      <div className="relative flex flex-col items-center">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${isCurrent ? 'animate-pulse' : ''}`}
                          style={{
                            backgroundColor: color,
                            color: isPending
                              ? 'var(--muted-foreground)'
                              : 'white',
                          }}
                        >
                          <Icon className="size-5" />
                        </div>
                        {index < orderData.timeline.length - 1 && (
                          <div
                            className="absolute top-10 w-0.5 h-full"
                            style={{
                              backgroundColor:
                                event.status === 'completed'
                                  ? 'var(--store-primary)'
                                  : 'var(--muted)',
                            }}
                          />
                        )}
                      </div>
                      <div className="flex-1 pt-1">
                        <p className="font-medium">{event.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {event.description}
                        </p>
                        {event.timestamp && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(event.timestamp)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {orderData.shipping_tracking && (
                <div
                  className="mt-6 p-4 rounded-lg"
                  style={{
                    backgroundColor:
                      'color-mix(in srgb, var(--store-primary) 10%, transparent)',
                  }}
                >
                  <p
                    className="font-medium"
                    style={{ color: 'var(--store-primary)' }}
                  >
                    Tracking Information
                  </p>
                  <p
                    className="text-sm mt-1"
                    style={{ color: 'var(--store-primary)' }}
                  >
                    {orderData.shipping_tracking.provider}:{' '}
                    {orderData.shipping_tracking.tracking_number}
                  </p>
                  <ThemedButton
                    variant="link"
                    className="p-0 h-auto mt-2"
                    style={{ color: 'var(--store-primary)' }}
                    asChild
                  >
                    <a
                      href={orderData.shipping_tracking.tracking_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Track with carrier{' '}
                      <ExternalLink className="ml-1 size-3" />
                    </a>
                  </ThemedButton>
                </div>
              )}
            </CardContent>
          </ThemedCard>

          {/* Order Items */}
          <ThemedCard>
            <CardHeader>
              <CardTitle>Order Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {orderData.items.map((item) => (
                  <OrderItemRow
                    key={item.id}
                    currency={orderData.order.currency}
                    formatCurrency={formatCurrency}
                    item={item}
                  />
                ))}
              </div>

              <Separator className="my-4" />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>
                    {formatCurrency(
                      orderData.order.subtotal,
                      orderData.order.currency
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>
                    {formatCurrency(
                      orderData.order.shipping_cost,
                      orderData.order.currency
                    )}
                  </span>
                </div>
                {orderData.order.discount_amount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>
                      -
                      {formatCurrency(
                        orderData.order.discount_amount,
                        orderData.order.currency
                      )}
                    </span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-medium text-base">
                  <span>Total</span>
                  <span>
                    {formatCurrency(
                      orderData.order.total,
                      orderData.order.currency
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
          </ThemedCard>

          {/* Shipping & Contact */}
          <div className="grid gap-6 sm:grid-cols-2">
            <ThemedCard>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="size-4" />
                  Shipping Address
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{orderData.customer.name}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {orderData.shipping_address.address}
                </p>
                <p className="text-sm text-muted-foreground">
                  {orderData.shipping_address.city},{' '}
                  {orderData.shipping_address.state}
                </p>
                <p className="text-sm text-muted-foreground">
                  {orderData.shipping_address.country}
                </p>
              </CardContent>
            </ThemedCard>

            <ThemedCard>
              <CardHeader>
                <CardTitle className="text-lg">Need Help?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {orderData.merchant.support_email && (
                  <a
                    href={`mailto:${orderData.merchant.support_email}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    style={{ color: 'var(--store-primary)' }}
                  >
                    <Mail className="size-4" />
                    {orderData.merchant.support_email}
                  </a>
                )}
                {orderData.merchant.support_phone && (
                  <a
                    href={`tel:${orderData.merchant.support_phone}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    style={{ color: 'var(--store-primary)' }}
                  >
                    <Phone className="size-4" />
                    {orderData.merchant.support_phone}
                  </a>
                )}
                {!orderData.merchant.support_email &&
                  !orderData.merchant.support_phone && (
                    <p className="text-sm text-muted-foreground">
                      Contact {orderData.merchant.name} for support
                    </p>
                  )}
              </CardContent>
            </ThemedCard>
          </div>
        </div>
      )}
    </div>
  );
}
