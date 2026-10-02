'use client';

import {
  ExternalLink,
  FileText,
  Leaf,
  Loader2,
  ReceiptText,
  Search,
  X,
} from 'lucide-react';
import type React from 'react';
import { Suspense, useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { EmptyState } from '../components/empty-state';
import { ReceiptModal } from '../components/ReceiptModal';
import { ReceiptStatusBadge } from '../components/ReceiptStatusBadge';
import { ReceiptClaimAppDownloadBanner } from './receipt-claim-app-download-banner';
import { useReceiptList } from './use-receipt-list';

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

export const OgabasseyV2Receipts: React.FC = () => {
  const {
    filteredReceipts,
    handleViewReceipt,
    isAuthenticated,
    isLoading,
    isModalOpen,
    merchantReceiptData,
    searchQuery,
    selectedDocumentKind,
    selectedOrder,
    setIsModalOpen,
    setSearchQuery,
    shouldShowOgabasseyAppBanner,
  } = useReceiptList();

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
                        <ReceiptStatusBadge status={receipt.status} />
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
                        {receipt.documentKind === 'proforma'
                          ? 'Proforma'
                          : receipt.paymentStatus === 'unpaid'
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
        documentKind={selectedDocumentKind}
      />
    </div>
  );
};
