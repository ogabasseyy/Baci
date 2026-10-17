import {
  orderRefundMethodLabels,
  orderRefundStatusLabels,
} from '@/config/order-refund';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { formatRefundActivityInstant } from './format-refund-activity-instant';

// Audit-event activity plus the bounded refund history, kept out of
// the panel so it stays under the size limit.
export function OrderRefundTimeline({
  currency,
  events,
  history,
}: {
  currency: string;
  events: NonNullable<RefundSummary['events']>;
  history: RefundSummary['history'];
}) {
  const money = (value: number) =>
    formatDisplayCurrency(value, currency, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <>
      {events.length > 0 && (
        <details>
          <summary>Refund activity</summary>
          <ul className="space-y-2 text-sm" aria-label="Refund activity">
            {events.map((event) => {
              // Event errors arrive pre-mapped at the API boundary,
              // so the timeline renders them directly, never verbatim
              // worker text. When both are present and differ, the
              // previous error keeps its own line instead of being
              // silently dropped.
              // The mask passes a null details value through for legacy
              // rows, so guard the dereference: one null-details event
              // must degrade to no error line, not crash the card.
              const eventError =
                event.details?.error || event.details?.previousError;
              const eventPreviousError =
                event.details?.error &&
                event.details?.previousError !== event.details?.error
                  ? event.details?.previousError
                  : undefined;
              return (
                <li key={event.id}>
                  <p>
                    {orderRefundStatusLabels[event.action] || 'Refund activity'}{' '}
                    · {formatRefundActivityInstant(event.date)}
                  </p>
                  {eventError && <p>{eventError}</p>}
                  {eventPreviousError && (
                    <p>Previously: {eventPreviousError}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {history.length > 0 && (
        <ul className="space-y-2 text-sm" aria-label="Refund history">
          {history.map((item) => (
            <li key={item.id} className="border-t pt-2">
              <p>
                {money(item.amount)} ·{' '}
                {orderRefundStatusLabels[item.status] ?? item.status} ·{' '}
                {orderRefundMethodLabels[item.method] ?? item.method}
              </p>
              <p className="break-all">{item.reference}</p>
              <p>{formatRefundActivityInstant(item.date)}</p>
              {item.note ? (
                <p className="break-words text-muted-foreground">{item.note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
