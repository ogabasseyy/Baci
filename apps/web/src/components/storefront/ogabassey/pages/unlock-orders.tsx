'use client';

import { Clock3, LockKeyhole, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { resolveStorefrontPathHref } from '@/lib/storefront-path-prefix';
import {
  type ImeiRemediationOrder,
  imeiRemediationApi,
} from './imei-remediation-api';

const NGN_FORMATTER = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  maximumFractionDigits: 0,
  style: 'currency',
});

function amount(order: ImeiRemediationOrder) {
  if (order.paymentCurrency === 'USDT' && order.amountUsdt !== null) {
    return `${order.amountUsdt.toFixed(2)} USDT`;
  }
  return order.amountNgn === null ? '—' : NGN_FORMATTER.format(order.amountNgn);
}

function statusLabel(status: string) {
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const UNLOCK_ORDERS_POLL_INTERVAL_MS = 30_000;
const UNLOCK_ORDERS_REQUEST_TIMEOUT_MS = 15_000;
const MAX_UNLOCK_ORDERS_POLL_ATTEMPTS = 60;

async function listWithTimeout(
  merchantSlug: string,
  timeoutMs: number
): Promise<ImeiRemediationOrder[]> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      imeiRemediationApi.list(merchantSlug),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Request timed out')),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function OgabasseyUnlockOrders() {
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath ?? '';
  const merchantSlug = merchantContext?.merchant?.slug;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const [orders, setOrders] = useState<ImeiRemediationOrder[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollGeneration intentionally resets the attempt budget on user retry.
  useEffect(() => {
    if (!merchantSlug) return;
    setPollingPaused(false);
    setError(null);
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const refresh = async () => {
      if (cancelled || inFlight) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (attempts >= MAX_UNLOCK_ORDERS_POLL_ATTEMPTS) {
        stopPolling();
        if (!cancelled) {
          setLoading(false);
          setPollingPaused(true);
        }
        return;
      }
      attempts += 1;
      inFlight = true;
      try {
        const result = await listWithTimeout(
          merchantSlug,
          UNLOCK_ORDERS_REQUEST_TIMEOUT_MS
        );
        if (!cancelled) {
          setOrders(result);
          setError(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Unable to refresh unlock orders right now.');
          setLoading(false);
        }
      } finally {
        inFlight = false;
        if (!cancelled && attempts >= MAX_UNLOCK_ORDERS_POLL_ATTEMPTS) {
          stopPolling();
          setPollingPaused(true);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    void refresh();
    interval = setInterval(refresh, UNLOCK_ORDERS_POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      cancelled = true;
      stopPolling();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [merchantSlug, pollGeneration]);

  const restartPolling = () => {
    setError(null);
    setPollingPaused(false);
    setLoading(orders.length === 0);
    setPollGeneration((current) => current + 1);
  };

  return (
    <main className="min-h-screen bg-[var(--store-background,#f9fafb)] px-4 py-8 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--store-primary,#dc2626)]">
              Carrier services
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-[var(--store-background-text,#111827)]">
              <LockKeyhole aria-hidden="true" size={24} /> Unlock orders
            </h1>
            <p className="mt-2 text-sm text-store-background-text/70">
              Carrier unlocks are not instant. Status updates appear here and we
              will also notify you when an order finishes.
            </p>
          </div>
          <a
            className="shrink-0 text-sm font-bold text-[var(--store-primary,#dc2626)]"
            href={resolveStorefrontPathHref(basePath, '/imei-check')}
          >
            New check
          </a>
        </div>

        {error || pollingPaused ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--store-border,#e5e7eb)] bg-[var(--ogabassey-surface)] px-4 py-3 text-sm">
            <span className="text-store-background-text/80">
              {error ?? 'Auto-refresh paused after checking for updates.'}
            </span>
            <button
              className="font-bold text-[var(--store-primary,#dc2626)] underline"
              onClick={restartPolling}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}

        {loading ? (
          <div
            aria-label="Loading unlock orders"
            className="mt-8 flex justify-center rounded-2xl border border-[var(--store-border,#e5e7eb)] bg-[var(--ogabassey-surface)] p-12"
            role="status"
          >
            <RefreshCw aria-hidden="true" className="animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-[var(--store-border,#e5e7eb)] bg-[var(--ogabassey-surface)] p-8 text-center">
            <h2 className="font-bold text-[var(--ogabassey-surface-text)]">
              No unlock orders yet
            </h2>
            <p className="mt-2 text-sm text-store-background-text/70">
              Eligible clean carrier-unlock options appear after a device check.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {orders.map((order) => (
              <article
                className="rounded-2xl border border-[var(--store-border,#e5e7eb)] bg-[var(--ogabassey-surface)] p-5 shadow-sm"
                key={order.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-[var(--store-primary,#dc2626)]">
                      {order.carrier || 'Carrier unlock'}
                    </p>
                    <h2 className="mt-1 font-bold text-[var(--ogabassey-surface-text)]">
                      {order.deviceModel || 'Device unlock'}
                    </h2>
                  </div>
                  <span className="rounded-full bg-[var(--store-option-secondary,#f3f4f6)] px-3 py-1 text-xs font-bold text-[var(--store-secondary-text,#111827)]">
                    {statusLabel(order.status)}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-store-background-text/70">
                      Paid
                    </dt>
                    <dd className="font-bold text-[var(--ogabassey-surface-text)]">
                      {amount(order)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-store-background-text/70">
                      Turnaround
                    </dt>
                    <dd className="font-bold text-[var(--ogabassey-surface-text)]">
                      {order.turnaround || 'Carrier estimate pending'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-store-background-text/70">
                      Updated
                    </dt>
                    <dd className="font-bold text-[var(--ogabassey-surface-text)]">
                      {new Date(order.updatedAt).toLocaleDateString('en-NG')}
                    </dd>
                  </div>
                </dl>
                {order.customerMessage ? (
                  <p className="mt-4 flex gap-2 rounded-xl bg-[var(--store-option-secondary,#f9fafb)] p-3 text-sm text-[var(--store-secondary-text,#111827)]">
                    <Clock3 aria-hidden="true" className="shrink-0" size={17} />
                    {order.customerMessage}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
