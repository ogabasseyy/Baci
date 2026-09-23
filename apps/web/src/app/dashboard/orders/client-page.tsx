'use client';

import { File, PlusCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  AGENTIC_ORDERS_CLEAR_FOCUS_HREF,
  getAgenticOrdersContext,
} from '@/app/dashboard/orders/agentic-orders-context';
import { OrderManagerModal } from '@/components/jumia/order-manager-modal';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BagLoader } from '@/components/ui/bag-loader';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { apiPatch } from '@/lib/api-client';
import { getCountryByCode } from '@/lib/countries';
import {
  getOrders,
  type Order,
  type OrderStats,
  type ShippingStatus,
} from './actions';
import {
  AGENTIC_ORDER_SOURCE_FILTER,
  isAgenticOrderSource,
  parseAgenticOrderSourceFilter,
} from './agentic-order-source';
import type { PaymentStatus } from './order-statuses';
import { OrdersFiltersBar } from './orders-filters-bar';
import { OrdersListCard } from './orders-list-card';
import { OrdersStatsCards } from './orders-stats-cards';
import { OrdersUrgentAlert } from './orders-urgent-alert';
import { resolveJumiaIntegrationId } from './resolve-jumia-integration-id';

const _currencyFormatterCache = new Map<string, Intl.NumberFormat>();
function getCurrencyFormatter(
  locale: string,
  currency: string
): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let formatter = _currencyFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    });
    _currencyFormatterCache.set(key, formatter);
  }
  return formatter;
}

interface OrdersClientPageProps {
  initialOrders?: Order[];
  initialOrdersError?: string | null;
  initialStats?: OrderStats;
}

function formatStatusForDb(status: string) {
  return status.toLowerCase().replace(/\s+/g, '_');
}

export default function OrdersClientPage({
  initialOrders = [],
  initialOrdersError = null,
  initialStats = {
    totalOrders: 0,
    completedOrders: 0,
    unpaidOrders: 0,
    urgentOrders: 0,
  },
}: OrdersClientPageProps) {
  const searchParams = useSearchParams();
  const { merchant, loading: merchantLoading, hasPermission } = useMerchant();
  const canManageIntegrations = hasPermission('integrations', 'manage');
  const { loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | 'All'>(
    'All'
  );
  const [shippingFilter, setShippingFilter] = useState<ShippingStatus | 'All'>(
    'All'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [showAlert, setShowAlert] = useState(true);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(
    initialOrdersError
  );
  const [selectedJumiaOrder, setSelectedJumiaOrder] = useState<Order | null>(
    null
  );
  const [jumiaIntegrations, setJumiaIntegrations] = useState<
    Array<{ id: string; shop_id?: string | null; shop_name: string }>
  >([]);
  const [jumiaConnectLoading, setJumiaConnectLoading] = useState(true);
  const [jumiaConnectError, setJumiaConnectError] = useState<string | null>(
    null
  );
  const agenticIssue = searchParams.get('agentic_issue');
  const agenticOrdersContext = getAgenticOrdersContext(agenticIssue);
  const sourceFilter = parseAgenticOrderSourceFilter(
    searchParams.get('source')
  );
  const requestedJumiaIntegrationId = searchParams.get('integrationId');
  const isHydrated = useRef(false);
  const merchantId = merchant?.id ?? null;
  const [prevMerchantId, setPrevMerchantId] = useState<
    string | null | undefined
  >(undefined);

  // Reset Jumia connection state whenever the merchant identity changes.
  // Adjusting state during render (with a prev-compare guard) avoids the
  // extra stale-UI commit an effect-based reset would cause.
  if (prevMerchantId !== merchantId) {
    setPrevMerchantId(merchantId);
    setJumiaIntegrations([]);
    setJumiaConnectError(null);
    setJumiaConnectLoading(Boolean(merchantId));
  }

  // Fetch active Jumia integrations for order management
  useEffect(() => {
    if (!merchantId) {
      return;
    }
    const controller = new AbortController();
    fetch('/api/marketplace/jumia/connect', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch Jumia integrations');
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const integrations = Array.isArray(data.integrations)
          ? data.integrations.filter(
              (
                i: unknown
              ): i is {
                id: string;
                shop_id?: string | null;
                shop_name: string;
                [k: string]: unknown;
              } =>
                typeof i === 'object' &&
                i !== null &&
                typeof (i as Record<string, unknown>).id === 'string'
            )
          : [];
        setJumiaIntegrations(integrations);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Failed to fetch Jumia integration:', err);
        if (!controller.signal.aborted) {
          setJumiaConnectError(
            err instanceof Error
              ? err.message
              : 'Failed to fetch Jumia integrations'
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setJumiaConnectLoading(false);
        }
      });
    return () => controller.abort();
  }, [merchantId]);

  const getIntegrationIdForOrder = (order: Order): string | null =>
    resolveJumiaIntegrationId(
      jumiaIntegrations,
      requestedJumiaIntegrationId,
      order.jumiaShopId
    );

  useEffect(() => {
    if (
      !isHydrated.current &&
      initialOrders.length > 0 &&
      paymentFilter === 'All' &&
      shippingFilter === 'All' &&
      !searchTerm
    ) {
      isHydrated.current = true;
      return;
    }

    isHydrated.current = true;

    if (!merchantId) {
      return;
    }

    let isStale = false;

    const fetchOrders = () => {
      setOrdersLoading(true);
      setOrdersError(null);

      getOrders(merchantId, {
        paymentStatus: paymentFilter,
        shippingStatus: shippingFilter,
        search: searchTerm,
        ...(sourceFilter ? { source: sourceFilter } : {}),
      })
        .then((fetchedOrders) => {
          if (isStale) return;
          setOrders(fetchedOrders);
        })
        .catch(() => {
          if (isStale) return;
          setOrdersError('Could not load orders.');
          toast({
            title: 'Error Fetching Orders',
            description: 'Could not load orders. Please try again.',
            variant: 'destructive',
          });
        })
        .finally(() => {
          if (isStale) return;
          setOrdersLoading(false);
        });
    };

    const timer = window.setTimeout(
      () => {
        fetchOrders();
      },
      searchTerm ? 500 : 0
    );

    return () => {
      isStale = true;
      window.clearTimeout(timer);
    };
  }, [
    initialOrders.length,
    merchantId,
    paymentFilter,
    searchTerm,
    shippingFilter,
    sourceFilter,
    toast,
  ]);

  const handleUpdateStatus = async (
    orderNumber: string,
    newStatus: ShippingStatus
  ) => {
    const order = orders.find(
      (candidate) => candidate.orderNumber === orderNumber
    );

    if (!order?.id) {
      toast({
        title: 'Error',
        description: `Could not find order ${orderNumber} to update.`,
        variant: 'destructive',
      });
      return;
    }

    try {
      await apiPatch(`/api/orders/${order.id}`, {
        shipping_status: formatStatusForDb(newStatus),
      });

      setOrders((currentOrders) =>
        currentOrders.map((candidate) =>
          candidate.orderNumber === orderNumber
            ? { ...candidate, shippingStatus: newStatus }
            : candidate
        )
      );

      toast({
        title: `Order ${newStatus}! 🎉`,
        description: `Order ${orderNumber} has been updated.`,
      });
    } catch (_error) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: 'Failed to update order status. Please try again.',
      });
    }
  };

  const formatCurrency = (amount: number) => {
    const country = merchant?.country
      ? getCountryByCode(merchant.country)
      : undefined;
    const locale = country ? `en-${country.code}` : 'en-US';
    const currency = country ? country.currency : 'USD';
    return getCurrencyFormatter(locale, currency).format(amount);
  };

  const filteredOrders = orders.filter((order) => {
    const paymentMatch =
      paymentFilter === 'All' || order.paymentStatus === paymentFilter;
    const shippingMatch =
      shippingFilter === 'All' || order.shippingStatus === shippingFilter;
    const searchMatch =
      searchTerm === '' ||
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase());
    const sourceMatch =
      sourceFilter !== AGENTIC_ORDER_SOURCE_FILTER ||
      isAgenticOrderSource(order.source);

    return paymentMatch && shippingMatch && searchMatch && sourceMatch;
  });

  const handleSelectOrder = (orderNumber: string, isSelected: boolean) => {
    setSelectedOrders((currentSelection) => {
      const nextSelection = new Set(currentSelection);

      if (isSelected) {
        nextSelection.add(orderNumber);
      } else {
        nextSelection.delete(orderNumber);
      }

      return nextSelection;
    });
  };

  const handleSelectAll = (isSelected: boolean) => {
    if (isSelected) {
      setSelectedOrders(
        new Set(filteredOrders.map((order) => order.orderNumber))
      );
      return;
    }

    setSelectedOrders(new Set());
  };

  const applyBulkOrderUpdate = (
    updater: (order: Order) => Order,
    successTitle: string,
    successDescription: string
  ) => {
    if (selectedOrders.size === 0) {
      return;
    }

    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        selectedOrders.has(order.orderNumber) ? updater(order) : order
      )
    );
    setSelectedOrders(new Set());
    toast({
      title: successTitle,
      description: successDescription,
    });
  };

  const handleMarkSelectedPaymentStatus = (paymentStatus: PaymentStatus) => {
    applyBulkOrderUpdate(
      (order) => ({ ...order, paymentStatus }),
      `Marked ${paymentStatus.toLowerCase()}`,
      `${selectedOrders.size} selected order${selectedOrders.size === 1 ? '' : 's'} updated.`
    );
  };

  const handleFulfillSelectedOrders = () => {
    applyBulkOrderUpdate(
      (order) => ({
        ...order,
        shippingStatus:
          order.shippingStatus === 'Pending'
            ? 'Processing'
            : order.shippingStatus,
      }),
      'Fulfillment started',
      `${selectedOrders.size} selected order${selectedOrders.size === 1 ? '' : 's'} moved into processing.`
    );
  };

  const handleDeleteSelectedOrders = () => {
    const selectedCount = selectedOrders.size;
    setOrders((currentOrders) =>
      currentOrders.filter((order) => !selectedOrders.has(order.orderNumber))
    );
    setSelectedOrders(new Set());
    toast({
      title: 'Orders removed from view',
      description: `${selectedCount} selected order${selectedCount === 1 ? '' : 's'} removed.`,
    });
  };

  if (authLoading || merchantLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <BagLoader size={32} />
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col gap-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      <div className="pointer-events-none absolute left-0 top-0 -z-10 h-full w-full bg-[url('/grid.svg')] bg-center opacity-50 mask-[linear-gradient(180deg,white,rgba(255,255,255,0))]" />

      <div className="flex items-center justify-between">
        <h1 className="bg-linear-to-r from-primary via-purple-500 to-blue-600 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
          Orders 📦
        </h1>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            className="size-11 min-h-[44px] min-w-[44px]"
          >
            <File className="size-4" />
            <span className="sr-only">Export</span>
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-11 min-h-[44px] min-w-[44px]"
          >
            <RefreshCw className="size-4" />
            <span className="sr-only">Refresh</span>
          </Button>
          <Link href="/dashboard/orders/create">
            <Button size="sm" className="h-11 min-h-[44px] gap-1">
              <PlusCircle className="size-4" />
              <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                Create Order
              </span>
            </Button>
          </Link>
        </div>
      </div>

      <OrdersStatsCards stats={initialStats} statsLoading={false} />

      <OrdersFiltersBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        paymentFilter={paymentFilter}
        onPaymentFilterChange={setPaymentFilter}
        shippingFilter={shippingFilter}
        onShippingFilterChange={setShippingFilter}
      />

      {agenticOrdersContext ? (
        <Alert className="border-blue-200 bg-blue-50/80 text-blue-900 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-100">
          <AlertTitle>Agentic checkout focus</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{agenticOrdersContext.summary}</p>
            <p className="text-xs text-current/80">
              Next step: {agenticOrdersContext.nextStep}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {agenticOrdersContext.trustControlsHref ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={agenticOrdersContext.trustControlsHref}>
                    Open trust controls
                  </Link>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="ghost">
                <Link href={AGENTIC_ORDERS_CLEAR_FOCUS_HREF}>Clear focus</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <OrdersUrgentAlert
        showAlert={showAlert}
        stats={initialStats}
        statsLoading={false}
        onDismiss={() => setShowAlert(false)}
        onResolve={() =>
          toast({
            title: 'Coming Soon',
            description: 'This feature will filter to show only urgent orders.',
          })
        }
      />

      <OrdersListCard
        filteredOrders={filteredOrders}
        selectedOrders={selectedOrders}
        ordersLoading={ordersLoading}
        ordersError={ordersError}
        onSelectAll={handleSelectAll}
        onSelectOrder={handleSelectOrder}
        onStatusUpdate={handleUpdateStatus}
        jumiaConnectLoading={jumiaConnectLoading}
        onManageJumia={(order) => {
          if (jumiaConnectLoading) {
            toast({
              title: 'Loading Jumia integration',
              description: 'Fetching integration details...',
            });
            return;
          }
          if (jumiaConnectError) {
            toast({
              title: 'Jumia Connection Failed',
              description: `${jumiaConnectError}. Please refresh to retry.`,
              variant: 'destructive',
            });
            return;
          }
          if (jumiaIntegrations.length === 0) {
            toast({
              title: 'Jumia Not Connected',
              description:
                'No active Jumia integration found. Connect your Jumia account first.',
              variant: 'destructive',
            });
            return;
          }
          const resolvedId = getIntegrationIdForOrder(order);
          if (!resolvedId) {
            toast({
              title: 'Multiple Jumia shops',
              description:
                'Multiple Jumia integrations found. Please manage this order from the Channels page.',
              variant: 'destructive',
            });
            return;
          }
          setSelectedJumiaOrder(order);
        }}
        onMarkPaid={() => handleMarkSelectedPaymentStatus('Paid')}
        onMarkUnpaid={() => handleMarkSelectedPaymentStatus('Unpaid')}
        onFulfillOrders={handleFulfillSelectedOrders}
        onDeleteSelected={handleDeleteSelectedOrders}
        formatCurrency={formatCurrency}
      />

      {selectedJumiaOrder && getIntegrationIdForOrder(selectedJumiaOrder) && (
        <OrderManagerModal
          onClose={() => setSelectedJumiaOrder(null)}
          orderId={selectedJumiaOrder.jumiaOrderId ?? selectedJumiaOrder.id}
          orderNumber={selectedJumiaOrder.orderNumber}
          integrationId={getIntegrationIdForOrder(selectedJumiaOrder) as string}
          canManage={canManageIntegrations}
        />
      )}
    </div>
  );
}
