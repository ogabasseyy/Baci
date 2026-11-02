'use client';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

type PaymentProps = { url: string; onClose: () => void };

export function OxygenHostedPayment(props: PaymentProps) {
  return <HostedPaymentDocument key={props.url} {...props} />;
}

function HostedPaymentDocument({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [frameMounted, setFrameMounted] = useState(false);
  useEffect(() => {
    // Paint the white checkout surface before creating a cross-origin frame.
    // The second frame gives the browser one intervening paint; no timer or
    // provider-readiness assumption is involved.
    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setFrameMounted(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
  }, []);
  return (
    <section
      aria-labelledby="oxygen-hosted-payment-title"
      className="relative flex h-full min-h-0 flex-col bg-white"
      style={{ backgroundColor: '#fff', colorScheme: 'light' }}
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-4">
        <h3
          id="oxygen-hosted-payment-title"
          className="font-semibold text-gray-900"
        >
          Secure payment
        </h3>
        <button
          type="button"
          aria-label="Back to payment plan"
          className="flex size-11 items-center justify-center rounded-full hover:bg-gray-100"
          onClick={onClose}
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
      </header>
      <div
        className="relative min-h-0 flex-1 bg-white"
        aria-busy={loading}
        style={{
          backgroundColor: '#fff',
          isolation: 'isolate',
          contain: 'paint',
        }}
      >
        {loading && (
          <div
            role="status"
            aria-label="Loading secure payment"
            className="absolute inset-0 z-10 flex flex-col gap-6 bg-white p-5"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              backgroundColor: '#fff',
            }}
          >
            <span className="sr-only">Loading secure payment</span>
            <div
              aria-hidden="true"
              className="grid gap-6 motion-safe:animate-pulse"
            >
              <div className="h-4 w-32 rounded bg-gray-100" />
              <div className="h-20 rounded-xl bg-gray-100" />
              <div className="h-3 w-40 rounded bg-gray-100" />
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex h-20 items-center gap-4 border-b border-gray-100"
                >
                  <div className="size-9 rounded-full bg-rose-50" />
                  <div className="h-3 w-36 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          </div>
        )}
        {frameMounted && (
          <iframe
            title="Oxygen secure payment"
            src={url}
            allow="payment"
            referrerPolicy="no-referrer"
            aria-hidden={loading}
            tabIndex={loading ? -1 : undefined}
            className={`h-full w-full border-0 bg-white ${loading ? 'invisible' : ''}`}
            style={{
              colorScheme: 'light',
              backgroundColor: '#fff',
              visibility: loading ? 'hidden' : 'visible',
            }}
            onLoad={() => setLoading(false)}
          />
        )}
      </div>
    </section>
  );
}
