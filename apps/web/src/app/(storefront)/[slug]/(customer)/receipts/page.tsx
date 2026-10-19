'use client';

import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  ReceiptText,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { loadArchiveOrders } from '@/app/(storefront)/[slug]/(customer)/receipts/load-archive-orders';
import { ReceiptsStateCard } from '@/app/(storefront)/[slug]/(customer)/receipts/receipts-state-card';
import { OgabasseyV2Receipts } from '@/components/storefront/ogabassey/pages/receipts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { asRoute } from '@/lib/routes';
import { normalizeShippingStatus } from '@/lib/storefront-account-document-data';
import type { StorefrontOrder } from '@/types/storefront-order';

const ARCHIVE_STATUSES = new Set(['shipped', 'delivered']);
const ARCHIVE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function formatArchiveDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return ARCHIVE_DATE_FORMATTER.format(date);
}

/**
 * Customer-facing document label for an archived order. The invoice route
 * downloads a 325 proforma for unpaid invoice-method orders, so the badge,
 * download CTA, and type search must say proforma — not invoice — for the
 * same document. Download hrefs still use `current_document_kind`.
 */
function resolveArchiveDocumentKind(order: StorefrontOrder) {
  const kind = order.current_document_kind || 'invoice';
  if (kind === 'receipt') {
    return kind;
  }
  return order.invoice_type_code === '325' ? 'proforma' : kind;
}

export default function ReceiptsPage() {
  const router = useRouter();
  const { merchant, loading: merchantLoading, basePath } = useMerchant();
  const {
    customer,
    isAuthenticated,
    isLoading: authLoading,
  } = useCustomerAuth();
  const resolvedBasePath = basePath || '';
  const merchantSlug = merchant?.slug;

  useEffect(() => {
    if (!merchantLoading && !authLoading && !isAuthenticated) {
      router.push(
        asRoute(
          `${resolvedBasePath}/account/login?redirect=${encodeURIComponent(
            `${resolvedBasePath}/receipts`
          )}`
        )
      );
    }
  }, [merchantLoading, authLoading, isAuthenticated, router, resolvedBasePath]);

  if (merchantLoading || authLoading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <Skeleton className="mb-4 h-8 w-56" />
          <Skeleton className="mb-4 h-11 w-full" />
          <Skeleton className="h-44" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <ReceiptsStateCard
            title="Redirecting to sign in"
            message="Please sign in to view your receipts and invoices."
            actionLabel="Go to sign in"
            onAction={() => {
              router.push(
                asRoute(
                  `${resolvedBasePath}/account/login?redirect=${encodeURIComponent(
                    `${resolvedBasePath}/receipts`
                  )}`
                )
              );
            }}
          />
        </div>
      </div>
    );
  }

  if (!customer || !merchantSlug) {
    return (
      <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <ReceiptsStateCard
            title="Documents unavailable"
            message="We could not load your account details for this storefront."
            actionLabel="Reload page"
            onAction={() => {
              router.refresh();
            }}
          />
        </div>
      </div>
    );
  }

  const isOgabassey = merchant?.template_id === 'ogabassey';

  if (isOgabassey) {
    return <OgabasseyV2Receipts />;
  }

  return (
    <StandardReceiptsPage
      merchantSlug={merchantSlug}
      resolvedBasePath={resolvedBasePath}
    />
  );
}

interface StandardReceiptsPageProps {
  merchantSlug: string;
  resolvedBasePath: string;
}

function StandardReceiptsPage({
  merchantSlug,
  resolvedBasePath,
}: StandardReceiptsPageProps) {
  const [orders, setOrders] = useState<StorefrontOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const archiveOrdersControllerRef = useRef<AbortController | null>(null);
  const getHref = (path: string) => `${resolvedBasePath}${path}`;

  useEffect(() => {
    archiveOrdersControllerRef.current?.abort();
    const controller = new AbortController();
    archiveOrdersControllerRef.current = controller;
    void loadArchiveOrders({
      merchantSlug,
      setOrders,
      setIsLoadingOrders,
      setOrdersError,
      signal: controller.signal,
    });

    return () => {
      archiveOrdersControllerRef.current?.abort();
      archiveOrdersControllerRef.current = null;
    };
  }, [merchantSlug]);

  const archiveOrders = orders.filter(
    (order) =>
      Boolean(order.receipt_eligible) ||
      ARCHIVE_STATUSES.has(normalizeShippingStatus(order.shipping_status)) ||
      order.payment_method === 'invoice' ||
      order.paymentMethod === 'invoice'
  );

  const query = searchQuery.trim().toLowerCase();
  const filteredOrders = query
    ? archiveOrders.filter((order) => {
        const matchesOrder = order.order_number.toLowerCase().includes(query);
        const matchesItems = order.items.some((item) =>
          (item.product_name || item.name).toLowerCase().includes(query)
        );
        const matchesType = resolveArchiveDocumentKind(order)
          .toLowerCase()
          .includes(query);

        return matchesOrder || matchesItems || matchesType;
      })
    : archiveOrders;

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button asChild size="icon" variant="ghost">
            <Link
              aria-label="Back to account"
              href={asRoute(getHref('/account'))}
            >
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Receipts & Invoices</h1>
            <p className="text-sm text-muted-foreground">
              Orders appear here once their receipt or invoice is available.
            </p>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search orders by number, product, or document type"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by order number, product, or document type"
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {isLoadingOrders ? (
          <div className="flex items-center justify-center py-20">
            <output
              aria-label="Loading receipts and invoices"
              className="sr-only"
            >
              Loading receipts and invoices
            </output>
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : ordersError ? (
          <ReceiptsStateCard
            title="Unable to load documents"
            message={ordersError}
            actionLabel="Try Again"
            onAction={() => {
              archiveOrdersControllerRef.current?.abort();
              const controller = new AbortController();
              archiveOrdersControllerRef.current = controller;

              void loadArchiveOrders({
                merchantSlug,
                setOrders,
                setIsLoadingOrders,
                setOrdersError,
                signal: controller.signal,
              });
            }}
          />
        ) : filteredOrders.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <ReceiptText className="mx-auto mb-4 size-14 text-muted-foreground/60" />
              <h2 className="mb-2 text-lg font-semibold">No documents yet</h2>
              <p className="text-muted-foreground">
                Receipts or invoices will appear here when they become
                available.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => {
              const documentKind = order.current_document_kind || 'invoice';
              const archiveKind = resolveArchiveDocumentKind(order);
              const downloadHref = `/api/storefront/account/orders/${order.id}/${documentKind}?merchantSlug=${encodeURIComponent(merchantSlug)}`;
              const downloadLabel =
                archiveKind === 'receipt'
                  ? 'Receipt'
                  : archiveKind === 'proforma'
                    ? 'Proforma Invoice'
                    : 'Invoice';

              return (
                <Card key={order.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-4 gap-y-0">
                    <div>
                      <CardTitle className="text-lg">
                        #{order.order_number}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatArchiveDate(order.created_at)} •{' '}
                        {order.items[0]?.product_name ||
                          order.items[0]?.name ||
                          'Order'}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium capitalize">
                      <FileText className="size-3.5" />
                      {archiveKind}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      <p>
                        Total:{' '}
                        {formatDisplayCurrency(
                          order.total,
                          order.currency || 'NGN'
                        )}
                      </p>
                      <p className="capitalize">
                        Status: {order.shipping_status}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button asChild variant="outline">
                        <Link
                          href={asRoute(getHref(`/account/orders/${order.id}`))}
                        >
                          View Order
                        </Link>
                      </Button>
                      <Button asChild>
                        <a href={downloadHref}>
                          <Download className="mr-2 size-4" />
                          Download {downloadLabel}
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
