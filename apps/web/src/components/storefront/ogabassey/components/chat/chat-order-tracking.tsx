'use client';

import { useState } from 'react';
import {
  type StorefrontChatOrder,
  type StorefrontChatOrderTracking,
  storefrontChatAccountSchemas,
} from '@/schemas/storefront-chat-account';

const TRACKABLE_STATUSES = new Set([
  'shipped',
  'out_for_delivery',
  'delivered',
]);

export function ChatOrderTracking({
  order,
  merchantSlug,
}: {
  order: StorefrontChatOrder;
  merchantSlug: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StorefrontChatOrderTracking | null>(
    null
  );
  const [error, setError] = useState('');

  const status = order.shipping_status?.trim().toLowerCase() ?? '';
  const trackingNumber = order.tracking_number?.trim() ?? '';
  if (!TRACKABLE_STATUSES.has(status) || !trackingNumber) {
    return null;
  }

  const isGigl = order.shipping_provider?.trim().toUpperCase() === 'GIGL';

  const loadTracking = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/storefront/orders/${order.id}/tracking?merchantSlug=${encodeURIComponent(merchantSlug)}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!response.ok) {
        setError('Could not load live tracking right now. Please try again.');
        return;
      }
      const parsed = storefrontChatAccountSchemas.tracking.safeParse(
        await response.json()
      );
      if (!parsed.success) {
        setError('Could not read tracking details right now.');
        return;
      }
      setResult(parsed.data);
    } catch {
      setError('Could not load live tracking right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={loading}
        onClick={loadTracking}
        className="rounded-lg border px-3 py-1.5 text-xs font-medium"
      >
        {loading
          ? 'Checking delivery…'
          : result
            ? 'Refresh tracking'
            : isGigl
              ? 'Track GIG delivery'
              : 'Track delivery'}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-700">
          {error}
        </p>
      )}
      {result && !result.trackingAvailable && (
        <p role="status" className="mt-1.5 text-xs text-gray-600">
          {result.reason}
        </p>
      )}
      {result?.trackingAvailable && (
        <div
          role="status"
          className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-800"
        >
          <p className="font-semibold">
            {result.tracking.carrierName}: {result.tracking.statusLabel}
          </p>
          <p className="text-gray-600">
            Waybill: {result.tracking.trackingNumber}
          </p>
          {result.tracking.liveUnavailable ? (
            <p className="mt-1 text-gray-600">
              Live carrier updates are temporarily unavailable. Please check
              back shortly.
            </p>
          ) : result.tracking.events.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {result.tracking.events.slice(0, 4).map((event, idx) => (
                <li key={`${event.timestamp}-${idx}`}>
                  <span className="font-medium">{event.description}</span>
                  {event.location ? ` · ${event.location}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
