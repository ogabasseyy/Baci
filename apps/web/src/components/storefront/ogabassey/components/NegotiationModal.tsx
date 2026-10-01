'use client';

import { HandCoins, X } from 'lucide-react';
import type React from 'react';
import { useId } from 'react';
import type { CartItem } from '@/hooks/cart';
import { NegotiationModalStatusContent } from './NegotiationModalStatusContent';
import { NegotiationUploadForm } from './NegotiationUploadForm';
import { useNegotiationModalController } from './use-negotiation-modal-controller';
import { useNegotiationModalFocus } from './use-negotiation-modal-focus';

export { deriveCartLineNegotiationProps } from './negotiation-modal-cart';

interface NegotiationModalProps {
  cart?: CartItem[];
  condition?: string;
  currentPrice: number;
  isOpen: boolean;
  itemId?: string;
  merchantId: string;
  onClose: () => void;
  onSuccess: (finalPrice: number) => void;
  productBrand?: string;
  productName: string;
  productSlug?: string;
  type: 'single' | 'total';
  variantAttributes?: Record<string, string>;
  variantId?: string;
  variantName?: string;
  vatRate?: number;
}

export const NegotiationModal: React.FC<NegotiationModalProps> = ({
  cart,
  condition,
  currentPrice,
  isOpen,
  itemId,
  merchantId,
  onClose,
  onSuccess,
  productBrand,
  productName,
  productSlug,
  type,
  variantAttributes,
  variantId,
  variantName,
  vatRate = 0,
}) => {
  const offerInputId = useId();
  const uploadFileInputId = useId();
  const uploadLinkInputId = useId();
  const emailInputId = useId();
  const phoneInputId = useId();
  const controller = useNegotiationModalController({
    cart,
    condition,
    currentPrice,
    isOpen,
    itemId,
    merchantId,
    onSuccess,
    productBrand,
    productName,
    productSlug,
    type,
    variantAttributes,
    variantId,
    variantName,
    vatRate,
  });
  const { dialogRef, offerInputRef } = useNegotiationModalFocus({
    isOpen,
    onClose,
    status: controller.status,
  });
  const selectedVariantDetails = [
    variantName?.trim(),
    condition?.trim()
      ? `Condition: ${condition.trim().replace(/_/g, ' ')}`
      : null,
  ].filter(Boolean);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss negotiation modal backdrop"
        tabIndex={-1}
        data-testid="modal-backdrop"
        className="absolute inset-0 border-0 bg-[hsl(var(--foreground))]/60 p-0 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        aria-labelledby="negotiation-modal-title"
        aria-modal="true"
        className="bg-[hsl(var(--card))] rounded-2xl shadow-2xl w-full max-w-sm relative overflow-hidden z-10 animate-in zoom-in-95 duration-200"
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="bg-[hsl(var(--foreground))] p-4 flex justify-between items-center">
          <div className="flex items-center gap-2 text-[hsl(var(--background))]">
            <HandCoins size={20} className="text-[var(--store-primary)]" />
            <h3
              id="negotiation-modal-title"
              className="font-bold text-sm uppercase tracking-wider"
            >
              Negotiate Price
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[hsl(var(--background))]/70 hover:text-[hsl(var(--background))]"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <span className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
              Product
            </span>
            <p className="font-bold text-[hsl(var(--card-foreground))] line-clamp-1">
              {productName}
            </p>
            {selectedVariantDetails.length > 0 ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {selectedVariantDetails.join(' · ')}
              </p>
            ) : null}
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              Current Price:{' '}
              <span className="text-[hsl(var(--card-foreground))] font-semibold">
                ₦{currentPrice.toLocaleString()}
              </span>
            </p>
          </div>

          {controller.status === 'input' ? (
            <form onSubmit={controller.handleSubmit}>
              <label
                htmlFor={offerInputId}
                className="block text-sm font-medium text-[hsl(var(--card-foreground))] mb-2"
              >
                Your Offer (₦)
              </label>
              <div className="relative mb-6">
                <input
                  id={offerInputId}
                  ref={offerInputRef}
                  type="number"
                  value={controller.offer}
                  onChange={(event) => {
                    controller.setOffer(event.target.value);
                    if (controller.message) controller.setMessage('');
                  }}
                  className="w-full bg-[hsl(var(--card))] pl-4 pr-4 py-3 border border-[hsl(var(--border))] rounded-xl focus:ring-2 focus:ring-[var(--store-primary)] focus:border-[var(--store-primary)] outline-none transition-all text-lg font-bold text-[hsl(var(--card-foreground))] placeholder:font-normal"
                  placeholder="Enter amount..."
                />
              </div>
              {controller.message ? (
                <p
                  role="alert"
                  className="mb-4 text-sm text-[hsl(var(--destructive))]"
                >
                  {controller.message}
                </p>
              ) : null}
              <button
                type="submit"
                className="w-full bg-[var(--store-primary)] hover:bg-[var(--store-primary)]/90 text-[var(--store-primary-text)] font-bold py-3 rounded-xl transition-all shadow-md"
              >
                Submit Offer
              </button>
            </form>
          ) : null}

          {controller.status === 'upload' ? (
            <NegotiationUploadForm
              email={controller.email}
              emailInputId={emailInputId}
              onBack={() => controller.setStatus('failed')}
              onEmailChange={controller.setEmail}
              onFileChange={controller.setUploadFile}
              onLinkChange={controller.setUploadLink}
              onPhoneChange={controller.setPhone}
              onSubmit={controller.handleUploadSubmit}
              phone={controller.phone}
              phoneInputId={phoneInputId}
              uploadFile={controller.uploadFile}
              uploadFileInputId={uploadFileInputId}
              uploadLink={controller.uploadLink}
              uploadLinkInputId={uploadLinkInputId}
            />
          ) : null}

          <NegotiationModalStatusContent
            attemptCount={controller.attemptCount}
            counterOffer={controller.counterOffer}
            message={controller.message}
            onAcceptCounter={controller.handleAcceptCounter}
            onClose={onClose}
            onNegotiateAgain={() => {
              controller.setMessage('');
              controller.setStatus('input');
            }}
            onShowUpload={() => controller.setStatus('upload')}
            status={controller.status}
          />
        </div>
      </div>
    </div>
  );
};
