'use client';

import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChatOrderActions } from './chat-order-actions';

/** Account data is fetched and rendered by the storefront, outside Chatwoot. */
export function ChatwootOrdersPanel({
  storeSlug,
  onClose,
  onContinueApplication,
}: {
  storeSlug: string;
  onClose: () => void;
  onContinueApplication: (orderId: string) => void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const holder = document.getElementById('cw-widget-holder');
  const frame = document.getElementById('chatwoot_live_chat_widget');
  const widget = holder?.contains(frame) ? frame : null;

  useEffect(() => {
    if (!widget) return;
    const wasInert = widget.inert;
    widget.inert = true;
    back.current?.focus({ preventScroll: true });
    return () => {
      widget.inert = wasInert;
      widget.focus({ preventScroll: true });
    };
  }, [widget]);

  if (!holder || !widget) return null;
  return createPortal(
    <section
      aria-label="Your orders in Ekaette"
      className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-[inherit] bg-white text-gray-900"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-3">
        <button
          ref={back}
          type="button"
          aria-label="Back to conversation"
          className="grid size-10 place-items-center rounded-lg hover:bg-gray-100"
          onClick={onClose}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="font-semibold">Your orders</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <ChatOrderActions
          merchantSlug={storeSlug}
          allowStagingStore
          onContinueApplication={onContinueApplication}
        />
      </div>
    </section>,
    holder
  );
}
