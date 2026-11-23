'use client';

import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { notifyCheckoutAuthChanged } from '@/components/storefront/checkout-auth-notification';
import { supportsCheckoutSocialSignIn } from '@/components/storefront/ogabassey/components/checkout-social-support';

const LazyCheckoutCodeSignin = lazy(() =>
  import('@/components/storefront/checkout-code-signin').then((module) => ({
    default: module.CheckoutCodeSignin,
  }))
);

/** First-party sign-in panel rendered inside #cw-widget-holder above the Chatwoot iframe. */
export function ChatwootSignInPanel({
  storeSlug,
  onClose,
  onSuccess,
}: {
  storeSlug: string;
  onClose: () => void;
  onSuccess: () => void;
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

  const socialReturnTo =
    typeof window !== 'undefined' &&
    supportsCheckoutSocialSignIn(
      window.location.hostname,
      process.env.NODE_ENV === 'production'
    )
      ? `${window.location.pathname}${window.location.search}`
      : undefined;

  return createPortal(
    <section
      aria-label="Sign in to continue in Ekaette"
      className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-[inherit] bg-background text-foreground"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          ref={back}
          type="button"
          aria-label="Back to conversation"
          className="grid size-10 place-items-center rounded-lg hover:bg-muted"
          onClick={onClose}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h2 className="font-semibold">Sign in</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-4 text-sm text-muted-foreground">
          Sign in to access your saved address and continue checkout.
        </p>
        <Suspense fallback={<p role="status">Loading sign-in…</p>}>
          <LazyCheckoutCodeSignin
            merchantSlug={storeSlug}
            socialReturnTo={socialReturnTo}
            onSuccess={() => {
              notifyCheckoutAuthChanged();
              onSuccess();
              onClose();
            }}
          />
        </Suspense>
      </div>
    </section>,
    holder
  );
}
