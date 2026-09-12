'use client';

import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { formatCanonicalProductConditionLabel } from '@baci/shared/lib';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Leaf,
  Loader2,
  ReceiptText,
  Search,
  X,
} from 'lucide-react';
import type React from 'react';
import { Suspense, useEffect, useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { EmptyState } from '../components/empty-state';
import { ReceiptModal } from '../components/ReceiptModal';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { ReceiptClaimAppDownloadBanner } from './receipt-claim-app-download-banner';

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = currencyFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    });
    currencyFormatterCache.set(currency, formatter);
  }
  return formatter;
}

/** List item for display in the receipts grid */
interface ReceiptListItem {
  id: string;
  order_number: string;
  date: string;
  total: string;
  status: 'Paid' | 'Partially Paid' | 'Unpaid';
  paymentStatus: 'paid' | 'partially_paid' | 'unpaid';
  balance: string;
  firstProductName: string;
  firstProductImage: string | null;
  additionalDeviceCount: number;
  /** Raw order data for the shared receipt generator */
  rawOrder: ReceiptOrder;
}

interface ReceiptCustomerInfo {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getReceiptItemImage(item: Record<string, unknown> | undefined) {
  if (!item) {
    return null;
  }

  return (
    getStringValue(item.product_image) ||
    getStringValue(item.image) ||
    getStringValue(item.image_url) ||
    (Array.isArray(item.product_images)
      ? getStringValue(item.product_images[0])
      : null)
  );
}

function getReceiptItemName(item: Record<string, unknown> | undefined) {
  if (!item) {
    return 'Unknown item';
  }

  return (
    getStringValue(item.product_name) ||
    getStringValue(item.name) ||
    'Unknown item'
  );
}

function getReceiptItemVariantName(item: Record<string, unknown> | undefined) {
  return (
    getStringValue(item?.variant_name) ||
    formatCanonicalProductConditionLabel(getStringValue(item?.condition))
  );
}

function getReceiptItemDisplayName(item: Record<string, unknown> | undefined) {
  const baseName = getReceiptItemName(item);
  const variantName = getReceiptItemVariantName(item);
  return variantName && !baseName.includes(`(${variantName})`)
    ? `${baseName} (${variantName})`
    : baseName;
}

function getReceiptItemQuantity(item: Record<string, unknown>) {
  const quantity = Number(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getAdditionalDeviceCount(items: Array<Record<string, unknown>>) {
  const totalDeviceCount = items.reduce(
    (count, item) => count + getReceiptItemQuantity(item),
    0
  );

  return Math.max(0, totalDeviceCount - 1);
}

function ReceiptProductThumbnail({
  imageSrc,
  productName,
}: {
  imageSrc: string | null;
  productName: string;
}) {
  const [hasImageError, setHasImageError] = useState(false);
  const shouldRenderImage = Boolean(imageSrc && !hasImageError);

  return (
    <div
      aria-label={
        shouldRenderImage
          ? undefined
          : `No product image available for ${productName}`
      }
      className="ogabassey-product-card-image-surface w-16 h-16 md:w-20 md:h-20 bg-gray-50 rounded-xl p-2 shrink-0 border border-gray-100 flex items-center justify-center relative overflow-hidden"
      role={shouldRenderImage ? undefined : 'img'}
    >
      {imageSrc && !hasImageError ? (
        <CdnFormatImage
          src={imageSrc}
          alt={productName}
          fill
          sizes="80px"
          className="object-contain mix-blend-multiply p-2"
          onError={() => setHasImageError(true)}
        />
      ) : (
        <ReceiptText
          aria-hidden="true"
          className="size-8 text-gray-300"
          strokeWidth={1.8}
        />
      )}
    </div>
  );
}

// Module-scope helper keeps async fetch/mapping logic out of the component
// body so React Compiler can memoize the component.
async function fetchReceiptListItems(
  merchantSlug: string,
  customer: ReceiptCustomerInfo | null
): Promise<ReceiptListItem[] | null> {
  const res = await fetch(
    `/api/storefront/orders?merchantSlug=${encodeURIComponent(merchantSlug)}`
  );
  const data = await res.json();

  if (!data.orders) {
    return null;
  }

  const customerName = customer
    ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
      'Customer'
    : 'Customer';

  return data.orders.map((order: Record<string, unknown>) => {
    const items = (order.items as Array<Record<string, unknown>>) ?? [];
    const currency = (order.currency as string) || 'NGN';
    const total = Number(order.total) || 0;
    const amountPaid = Number(order.amount_paid ?? total);
    const paymentStatus = (order.payment_status as string) || 'unpaid';
    const firstProductName = getReceiptItemDisplayName(items[0]);
    const additionalDeviceCount = getAdditionalDeviceCount(items);

    const formatCurrency = (val: number) =>
      getCurrencyFormatter(currency).format(val);

    const rawOrder: ReceiptOrder = {
      order_number:
        (order.order_number as string) ||
        String(order.id).slice(0, 8).toUpperCase(),
      created_at: order.created_at as string,
      transaction_date: order.transaction_date as string | null | undefined,
      currency,
      total,
      subtotal: Number(order.subtotal ?? total),
      shipping_fee: Number(order.shipping_fee ?? 0),
      tax_amount: Number(order.tax_amount ?? 0),
      discount_amount: Number(order.discount_amount ?? 0),
      amount_paid: amountPaid,
      balance: Number(order.balance ?? total - amountPaid),
      payment_status: paymentStatus,
      payment_method: (order.payment_method as string) ?? null,
      is_credit_order: (order.is_credit_order as boolean) ?? false,
      customer_name: customerName,
      customer_email: customer?.email || '',
      customer_phone: customer?.phone ?? null,
      shipping_address:
        (order.shipping_address as ReceiptOrder['shipping_address']) ?? null,
      virtual_account:
        (order.virtual_account as ReceiptOrder['virtual_account']) ?? null,
      fulfillment_details:
        (order.fulfillment_details as ReceiptOrder['fulfillment_details']) ??
        null,
      items: items.map((item) => ({
        product_name: getReceiptItemName(item),
        variant_name: getReceiptItemVariantName(item) || undefined,
        quantity: getReceiptItemQuantity(item),
        price: Number(item.price) || 0,
      })),
    };

    const statusLabel =
      paymentStatus === 'paid'
        ? 'Paid'
        : paymentStatus === 'partially_paid'
          ? 'Partially Paid'
          : 'Unpaid';

    return {
      id: order.id as string,
      order_number: rawOrder.order_number,
      date: new Date(
        (order.transaction_date as string | null | undefined) ||
          (order.created_at as string)
      ).toLocaleDateString(),
      total: formatCurrency(total),
      status: statusLabel,
      paymentStatus: paymentStatus as ReceiptListItem['paymentStatus'],
      balance: formatCurrency(Math.max(0, total - amountPaid)),
      firstProductName,
      firstProductImage: getReceiptItemImage(items[0]),
      additionalDeviceCount,
      rawOrder,
    } satisfies ReceiptListItem;
  });
}

export const OgabasseyV2Receipts: React.FC = () => {
  const { customer, isAuthenticated } = useCustomerAuth();
  const merchantContext = useMerchantSafe();

  const [searchQuery, setSearchQuery] = useState('');
  const [receipts, setReceipts] = useState<ReceiptListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<ReceiptOrder | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch orders
  useEffect(() => {
    const fetchOrders = () => {
      if (!isAuthenticated || !merchantContext?.merchant?.slug) {
        setIsLoading(false);
        return;
      }

      fetchReceiptListItems(merchantContext.merchant.slug, customer)
        .then((mapped) => {
          if (mapped) {
            setReceipts(mapped);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch receipts', err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    };

    fetchOrders();
  }, [isAuthenticated, merchantContext?.merchant?.slug, customer]);

  // Derive merchant receipt data from context during render
  const m = merchantContext?.merchant;
  const shouldShowOgabasseyAppBanner = m?.slug === 'ogabassey';
  const merchantReceiptData: ReceiptMerchant | null = m
    ? {
        business_name: m.business_name || null,
        logo_url: m.logo_url || null,
        email: m.email || '',
        phone: m.phone || null,
        support_email: m.support_email || null,
        support_phone: m.support_phone || null,
        business_address: m.business_address || null,
        cac_rc_number: null,
        tax_identification_number: null,
        legal_entity_name: null,
        brand_colors: m.brand_colors,
        vat_registration_status: m.vat_registration_status || null,
        vat_rate: m.vat_rate ?? null,
        bank_code: null,
        bank_account_number: null,
        bank_name: null,
        bank_account_name: null,
        social_media: m.social_media,
        pages: m.pages,
      }
    : null;

  const filteredReceipts = receipts.filter((receipt) => {
    const query = searchQuery.toLowerCase();
    return (
      receipt.order_number.toLowerCase().includes(query) ||
      receipt.firstProductName.toLowerCase().includes(query) ||
      receipt.status.toLowerCase().includes(query)
    );
  });

  const handleViewReceipt = (receipt: ReceiptListItem) => {
    setSelectedOrder(receipt.rawOrder);
    setIsModalOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="bg-green-50 text-green-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-green-100 flex items-center gap-1 w-fit">
            <CheckCircle2 size={12} /> Paid
          </span>
        );
      case 'Partially Paid':
        return (
          <span className="bg-yellow-50 text-yellow-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-yellow-100 flex items-center gap-1 w-fit">
            <Clock size={12} /> Partial
          </span>
        );
      default:
        return (
          <span className="bg-red-50 text-red-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-red-100 flex items-center gap-1 w-fit">
            <AlertCircle size={12} /> Unpaid
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <EmptyState
          title="Sign in to view receipts"
          description="Log in to your account to access your receipts and invoices."
          variant="generic"
          compact
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="text-red-600 fill-red-600" />
            Receipts & Invoices
          </h1>

          <div className="relative w-full md:w-96">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, Product or Status..."
              aria-label="Search receipts by ID, product, or status"
              className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-red-100 focus:border-red-200 transition-all text-sm"
            />
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={18}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Sustainability Banner */}
        <div className="bg-green-50 border border-green-100 rounded-xl p-4 mb-8 flex items-center gap-3">
          <div className="p-2 bg-white text-green-600 rounded-lg shrink-0 border border-green-100">
            <Leaf size={18} />
          </div>
          <div>
            <p className="text-xs font-bold text-green-800 uppercase tracking-wide mb-0.5">
              100% Paperless
            </p>
            <p className="text-sm text-green-700">
              By using digital receipts, you&apos;ve helped us save over 100k
              sheets of paper this year.
            </p>
          </div>
        </div>

        {shouldShowOgabasseyAppBanner ? (
          <Suspense fallback={null}>
            <ReceiptClaimAppDownloadBanner />
          </Suspense>
        ) : null}

        {filteredReceipts.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              title="No receipts found"
              description={
                searchQuery
                  ? `No results found for "${searchQuery}"`
                  : 'You have no transactions receipts yet. Orders you make will appear here.'
              }
              variant="generic"
              compact
            />
          </div>
        ) : (
          <div className="space-y-4">
            {filteredReceipts.map((receipt) => (
              <div
                key={receipt.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden group"
              >
                <div className="p-5 md:p-6 flex flex-col md:flex-row gap-6 md:items-center">
                  {/* Product Image */}
                  <ReceiptProductThumbnail
                    imageSrc={receipt.firstProductImage}
                    productName={receipt.firstProductName}
                  />

                  {/* Info Grid */}
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
                    {/* Column 1: Order Details */}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusBadge(receipt.status)}
                        <span className="text-xs text-gray-400">&bull;</span>
                        <span className="text-xs text-gray-500 font-medium">
                          {receipt.date}
                        </span>
                      </div>
                      <h3 className="flex items-center gap-2 min-w-0 font-bold text-gray-900 text-sm md:text-base">
                        <span className="truncate">
                          {receipt.firstProductName}
                        </span>
                        {receipt.additionalDeviceCount > 0 && (
                          <span className="shrink-0 rounded-full bg-[color:color-mix(in_srgb,var(--store-primary,#d62027)_10%,transparent)] px-2 py-0.5 text-[10px] font-bold leading-none text-[var(--store-primary,#d62027)] ring-1 ring-[color:color-mix(in_srgb,var(--store-primary,#d62027)_16%,transparent)]">
                            <span aria-hidden="true">
                              +{receipt.additionalDeviceCount}
                            </span>
                            <span className="sr-only">
                              , {receipt.additionalDeviceCount} additional
                              devices in this receipt
                            </span>
                          </span>
                        )}
                      </h3>
                      <p className="mt-0.5 text-xs font-medium text-[var(--store-muted-text,#6b7280)] truncate">
                        #{receipt.order_number}
                      </p>
                    </div>

                    {/* Column 2: Payment */}
                    <div className="flex flex-col justify-center">
                      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">
                        {receipt.paymentStatus === 'unpaid'
                          ? 'Total Due'
                          : 'Total Amount'}
                      </span>
                      <span
                        className={`font-bold text-lg ${receipt.paymentStatus === 'unpaid' ? 'text-red-600' : 'text-gray-900'}`}
                      >
                        {receipt.total}
                      </span>
                      {receipt.paymentStatus === 'partially_paid' && (
                        <span className="text-xs text-red-500 font-medium">
                          Bal: {receipt.balance}
                        </span>
                      )}
                    </div>

                    {/* Column 3: Actions */}
                    <div className="flex items-center justify-start md:justify-end gap-3 md:border-l md:border-gray-50 md:pl-6">
                      <button
                        type="button"
                        onClick={() => handleViewReceipt(receipt)}
                        className="flex items-center gap-2 text-xs font-bold text-gray-600 hover:text-red-600 hover:bg-red-50 py-2.5 px-4 rounded-xl transition-colors border border-gray-200 hover:border-red-100 group/btn"
                      >
                        <ExternalLink
                          size={14}
                          className="group-hover/btn:scale-110 transition-transform"
                        />
                        View{' '}
                        {receipt.paymentStatus === 'unpaid'
                          ? 'Invoice'
                          : 'Receipt'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ReceiptModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        orderData={selectedOrder}
        merchantData={merchantReceiptData}
      />
    </div>
  );
};
