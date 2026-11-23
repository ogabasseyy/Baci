'use client';

import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type OxygenCustomerPrefill,
  oxygenCustomerPrefillSchema,
} from '@/schemas/oxygen-customer-prefill';

const OxygenApplicationDialog = lazy(() =>
  import('@/components/payments/oxygen/OxygenApplicationDialog').then(
    ({ OxygenApplicationDialog }) => ({ default: OxygenApplicationDialog })
  )
);

/** A first-party sibling of the Chatwoot frame. Secure form data stays with Baci. */
export function ChatwootOxygenCard({
  orderId,
  storeSlug,
  hostedOrigins,
}: {
  orderId: string;
  storeSlug: string;
  hostedOrigins?: readonly string[];
}) {
  const [open, setOpen] = useState(true);
  const [contact, setContact] = useState<OxygenCustomerPrefill>();
  const [contactUnavailable, setContactUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const back = useRef<HTMLButtonElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  const holder = document.getElementById('cw-widget-holder');
  const frame = document.getElementById('chatwoot_live_chat_widget');
  const widget = holder?.contains(frame) ? frame : null;

  useEffect(() => {
    if (!open || contact) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ merchantSlug: storeSlug });
    async function loadContact() {
      try {
        const response = await fetch(
          `/api/storefront/account/orders/${encodeURIComponent(orderId)}?${query}`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok) throw new Error('Order contact unavailable');
        const { order } = await response.json();
        const names =
          typeof order?.customer_name === 'string'
            ? order.customer_name.trim().split(/\s+/)
            : [];
        const parsed = oxygenCustomerPrefillSchema.safeParse({
          first_name: names[0],
          last_name: names.slice(1).join(' '),
          email: order?.customer_email,
        });
        if (order?.id !== orderId || order.payment_method !== 'oxygen' ||
            !parsed.success || !parsed.data.email) {
          throw new Error('Order contact unavailable');
        }
        if (!controller.signal.aborted) setContact(parsed.data);
      } catch {
        if (!controller.signal.aborted) setContactUnavailable(true);
      }
    }
    void loadContact();
    return () => controller.abort();
  }, [attempt, contact, open, orderId, storeSlug]);

  useEffect(() => {
    if (!widget || !open) return;
    const wasInert = widget.inert;
    widget.inert = true;
    back.current?.focus({ preventScroll: true });
    return () => {
      widget.inert = wasInert;
      resume.current?.focus({ preventScroll: true });
    };
  }, [open, widget]);

  if (!holder || !widget) return null;
  return createPortal(
    <>
      {open ? <section
        aria-label="Ekaette secure application"
        className="flex flex-col overflow-hidden rounded-t-2xl border-t border-gray-200 bg-white text-gray-900 shadow-2xl"
        style={{ position: 'absolute', inset: 'auto 0 0', width: '100%', height: '64%', zIndex: 10 }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-2">
          <button
            ref={back}
            type="button"
            aria-label="Back to conversation"
            className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
            onClick={() => setOpen(false)}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Hide card
          </button>
          <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
            <LockKeyhole size={13} aria-hidden="true" />
            Secure card · hidden from chat
          </span>
        </div>
        <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0 }}>
          {contact ? (
            <Suspense fallback={<p role="status" className="p-4">Preparing your application…</p>}>
              <OxygenApplicationDialog
                embedded
                orderId={orderId}
                merchantSlug={storeSlug}
                prefill={contact}
                hostedOrigins={hostedOrigins}
              />
            </Suspense>
          ) : contactUnavailable ? (
            <div className="p-4">
              <p role="status">I couldn’t load the details from your checkout.</p>
              <button type="button" onClick={() => {
                setContactUnavailable(false);
                setAttempt(value => value + 1);
              }}>
                Try again
              </button>
            </div>
          ) : (
            <p role="status" className="p-4">Preparing your application…</p>
          )}
        </div>
      </section> : (
        <button
          ref={resume}
          type="button"
          className="absolute right-3 top-16 z-10 rounded-full bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-md"
          onClick={() => setOpen(true)}
        >
          Continue secure application
        </button>
      )}
    </>,
    holder
  );
}
