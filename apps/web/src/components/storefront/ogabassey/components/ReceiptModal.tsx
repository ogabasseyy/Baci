'use client';

import {
  generateReceiptHtml,
  type ReceiptDocumentKind,
  type ReceiptMerchant,
  type ReceiptOrder,
} from '@baci/shared/receipt';
import { Printer, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useId, useRef } from 'react';

const FOCUSABLE_MODAL_SELECTOR =
  'button:not([disabled]), iframe, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderData: ReceiptOrder | null;
  merchantData: ReceiptMerchant | null;
  /** Resolved kind from the orders API; only proforma changes the output. */
  documentKind?: ReceiptDocumentKind | null;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  orderData,
  merchantData,
  documentKind,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const printButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const isModalVisible = isOpen && Boolean(orderData) && Boolean(merchantData);

  useEffect(() => {
    if (!isModalVisible) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    printButtonRef.current?.focus();

    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [isModalVisible]);

  if (!isModalVisible || !orderData || !merchantData) return null;

  const isPaid = orderData.payment_status === 'paid';
  // Mirror the generator: paid always renders the commercial receipt even
  // if a stale proforma kind travels with the order.
  const isProforma = documentKind === 'proforma' && !isPaid;
  const documentTitle = isPaid
    ? 'Receipt'
    : isProforma
      ? 'Proforma Invoice'
      : 'Invoice';
  const documentLabel = documentTitle.toLowerCase();

  const html = generateReceiptHtml(orderData, merchantData, {
    documentKind: documentKind ?? undefined,
  });

  const handlePrint = () => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  };

  const getFocusableDialogElements = () => {
    const dialog = dialogRef.current;
    if (!dialog) return [];

    return Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_MODAL_SELECTOR)
    ).filter(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.tabIndex !== -1 &&
        element.dataset.focusGuard !== 'true'
    );
  };

  const focusFirstDialogElement = () => {
    getFocusableDialogElements()[0]?.focus();
  };

  const focusLastDialogElement = () => {
    getFocusableDialogElements().at(-1)?.focus();
  };

  const handleDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableDialogElements();
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    if (!firstElement || !lastElement) return;

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    // Let the browser move focus into the iframe document. The focus guard
    // after the iframe wraps focus back once users tab out of that document.
    if (
      !event.shiftKey &&
      document.activeElement === lastElement &&
      lastElement instanceof HTMLIFrameElement
    ) {
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-stretch justify-center p-0 md:p-4">
      <button
        type="button"
        aria-label="Dismiss receipt modal backdrop"
        tabIndex={-1}
        className="absolute inset-0 border-0 bg-black/60 p-0 backdrop-blur-xs"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex h-dvh max-h-dvh w-full max-w-[1440px] animate-in flex-col overflow-hidden rounded-none bg-[var(--store-surface,#ffffff)] shadow-2xl duration-200 zoom-in-95 md:h-[calc(100dvh_-_2rem)] md:max-h-[calc(100dvh_-_2rem)] md:rounded-2xl"
        onKeyDown={handleDialogKeyDown}
        role="dialog"
      >
        <button
          type="button"
          aria-label={`Return to ${documentLabel} preview`}
          className="sr-only"
          data-focus-guard="true"
          onFocus={focusLastDialogElement}
        />

        {/* Header Actions */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--store-border,#f3f4f6)] bg-[var(--store-muted-surface,#f9fafb)] p-4 md:rounded-t-2xl">
          <h3
            className="font-bold text-[var(--store-text,#111827)]"
            id={titleId}
          >
            {documentTitle} Details
          </h3>
          <div className="flex items-center gap-2">
            <button
              ref={printButtonRef}
              type="button"
              onClick={handlePrint}
              className="rounded-full p-2 text-[var(--store-muted-text,#6b7280)] transition-colors hover:bg-[var(--store-surface,#ffffff)]"
              title="Print or save as PDF"
              aria-label={`Print ${documentLabel}`}
            >
              <Printer size={18} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-[var(--store-muted-text,#6b7280)] transition-colors hover:bg-[var(--store-surface,#ffffff)]"
              aria-label={`Close ${documentLabel}`}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Shared HTML Receipt via iframe */}
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto bg-[var(--store-muted-surface,#f9fafb)] p-3 md:p-5">
          {/* react-doctor-disable-next-line react-doctor/no-noninteractive-tabindex -- iframe holds scrollable receipt content; tabIndex={0} is a real focus target so keyboard users can reach and scroll it within the modal focus trap. */}
          <iframe
            ref={iframeRef}
            srcDoc={html}
            tabIndex={0}
            title={`${documentTitle} #${orderData.order_number}`}
            className="block h-full min-h-0 w-[794px] max-w-full flex-1 border-0 bg-[var(--store-surface,#ffffff)] shadow-sm"
            sandbox="allow-same-origin"
          />
          <button
            type="button"
            aria-label={`Return to ${documentLabel} controls`}
            className="sr-only"
            data-focus-guard="true"
            onFocus={focusFirstDialogElement}
          />
        </div>
      </div>
    </div>
  );
};
