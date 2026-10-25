'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type OxygenJourneyStage,
  trackOxygenJourney,
} from '@/lib/payments/oxygen/journey-events';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import styles from './OxygenApplicationDialog.module.css';
import { OxygenHostedPayment } from './OxygenHostedPayment';
import { isOxygenSelfieUrl, OxygenHostedSelfie } from './OxygenHostedSelfie';
import {
  OxygenCheckoutCloseContext,
  OxygenPaymentOpenContext,
  OxygenPaymentSurfaceContext,
  OxygenSelfieConfirmedContext,
  OxygenSelfieSurfaceContext,
} from './OxygenPaymentSurfaceContext';
import type { OxygenCheckoutProduct } from './OxygenProductSummary';
import { OxygenProviderFlow } from './OxygenProviderFlow';
import { oxygenButtonClass } from './oxygen-checkout-styles';

export function OxygenApplicationDialog({
  orderId,
  merchantSlug,
  prefill,
  productAmount,
  products,
  currency,
}: {
  orderId: string;
  merchantSlug?: string;
  productAmount?: number;
  products?: OxygenCheckoutProduct[];
  currency?: string;
  prefill?: OxygenCustomerPrefill;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<OxygenJourneyStage>('loading');
  const [open, setOpen] = useState(true);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [selfieWorkflowId, setSelfieWorkflowId] = useState<string>();
  const [selfieConfirmed, setSelfieConfirmed] = useState<string | null>(null);
  const hostedOpen = Boolean(paymentUrl || selfieUrl);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    trackOxygenJourney('opened', orderId, stage.current);
    const leave = () => trackOxygenJourney('page_left', orderId, stage.current);
    window.addEventListener('pagehide', leave);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('pagehide', leave);
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!hostedOpen) return;
    const previousFocus = document.activeElement;
    dialog.current
      ?.querySelector<HTMLButtonElement>(
        '[aria-label="Back to payment plan"], [aria-label="Back to application"]'
      )
      ?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [hostedOpen]);

  function close() {
    dialog.current?.close();
  }

  return (
    <>
      <div className="px-6 pb-6 space-y-3">
        <p className="text-sm text-gray-600">
          Oxygen selected. Continue your application to choose a payment plan.
        </p>
        <button
          type="button"
          className={oxygenButtonClass}
          onClick={() => setOpen(true)}
        >
          Continue application
        </button>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="oxygen-application-title"
        aria-describedby="oxygen-application-description"
        className={`${styles.dialog} ${selfieUrl ? styles.selfieDialog : paymentUrl ? styles.paymentDialog : ''}`}
        onCancel={(event) => {
          event.preventDefault();
          if (selfieUrl) setSelfieUrl(null);
          else if (paymentUrl) setPaymentUrl(null);
          else close();
        }}
        onClose={() => {
          setOpen(false);
          setPaymentUrl(null);
          setSelfieUrl(null);
          trackOxygenJourney('closed', orderId, stage.current);
        }}
      >
        <header className="relative shrink-0" hidden={hostedOpen}>
          <h2 id="oxygen-application-title" className="sr-only">
            {selfieUrl
              ? 'Selfie verification'
              : paymentUrl
                ? 'Secure payment'
                : 'Your Oxygen application'}
          </h2>
          <p id="oxygen-application-description" className="sr-only">
            Review your details and choose a payment plan.
          </p>
          <button
            type="button"
            aria-label="Close application"
            className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={close}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>
        <OxygenSelfieSurfaceContext.Provider
          value={(url, workflowId) => {
            if (isOxygenSelfieUrl(url)) {
              setSelfieWorkflowId(workflowId);
              setSelfieUrl(url);
            }
          }}
        >
          <OxygenSelfieConfirmedContext.Provider value={selfieConfirmed}>
            <OxygenCheckoutCloseContext.Provider value={close}>
              <OxygenPaymentSurfaceContext.Provider value={setPaymentUrl}>
                <OxygenPaymentOpenContext.Provider value={!!paymentUrl}>
                  <div className={styles.body} hidden={hostedOpen}>
                    <OxygenProviderFlow
                      active={open && !selfieUrl}
                      orderId={orderId}
                      merchantSlug={merchantSlug}
                      prefill={prefill}
                      productAmount={productAmount}
                      products={products}
                      currency={currency}
                      onProgress={(value) => {
                        stage.current = value;
                      }}
                    />
                  </div>
                </OxygenPaymentOpenContext.Provider>
              </OxygenPaymentSurfaceContext.Provider>
            </OxygenCheckoutCloseContext.Provider>
          </OxygenSelfieConfirmedContext.Provider>
        </OxygenSelfieSurfaceContext.Provider>
        {selfieUrl && (
          <OxygenHostedSelfie
            key={selfieUrl}
            url={selfieUrl}
            workflowId={selfieWorkflowId}
            onConfirmed={() => {
              if (selfieWorkflowId) {
                setSelfieConfirmed(selfieWorkflowId);
                trackOxygenJourney('step_completed', orderId, 'selfie');
              }
              setSelfieUrl(null);
            }}
            onClose={() => setSelfieUrl(null)}
          />
        )}
        {paymentUrl && (
          <OxygenHostedPayment
            url={paymentUrl}
            onClose={() => setPaymentUrl(null)}
          />
        )}
      </dialog>
    </>
  );
}
