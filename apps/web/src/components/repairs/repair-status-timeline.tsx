import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import {
  getRepairStatusColorClasses,
  isRepairStatus,
  REPAIR_STATUS_LABELS,
  REPAIR_STATUS_TIMELINE,
  type RepairStatus,
} from '@/lib/repairs/repair-status';
import type { RepairStatusResult } from '@/lib/repairs/status-lookup';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { getRepairStatusIcon } from './repair-status-icon';

interface RepairStatusTimelineProps {
  result: RepairStatusResult;
  /** Link to the shipment tracking page when a courier pickup exists. */
  trackHref?: string | null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getPickupPaymentMessage(result: RepairStatusResult): string {
  if (result.pickupPaymentStatus === 'booked' || result.trackingNumber) {
    return result.trackingNumber
      ? 'Your GIGL pickup is booked. Follow its progress below.'
      : 'Your GIGL pickup is booked. Tracking will appear shortly.';
  }
  if (result.pickupPaymentStatus === 'awaiting_payment') {
    return 'Pickup payment is still required.';
  }
  if (!result.pickupPaymentStatus) {
    return 'Courier pickup will be arranged once your request is confirmed.';
  }
  if (result.pickupPaymentStatus === 'review') {
    return 'Payment confirmed. Your pickup needs support review.';
  }
  if (result.pickupPaymentStatus === 'manual_fulfilled') {
    return 'Manual courier arranged.';
  }
  return 'Payment confirmed. Arranging your GIGL pickup.';
}

export function RepairStatusTimeline({
  result,
  trackHref,
}: RepairStatusTimelineProps) {
  const status = result.status;
  const isTerminalOffPath = status === 'cancelled' || status === 'rejected';
  const currentIndex = REPAIR_STATUS_TIMELINE.indexOf(status);

  return (
    <div className="rounded-xl border border-store-border bg-store-background-text/5 p-6 text-store-background-text">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-store-background-text/60">
            Ticket #{result.ticketNumber}
          </p>
          <h2 className="mt-1 font-semibold text-xl">{result.deviceLabel}</h2>
          {result.repairTypeLabel ? (
            <p className="text-sm text-store-background-text/70">
              {result.repairTypeLabel}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-sm',
            getRepairStatusColorClasses(status)
          )}
        >
          {getRepairStatusIcon(status)}
          {REPAIR_STATUS_LABELS[status]}
        </span>
      </div>

      {isTerminalOffPath ? (
        <p
          className={cn(
            'mt-6 rounded-lg border px-4 py-3 text-sm',
            getRepairStatusColorClasses(status)
          )}
        >
          {status === 'cancelled'
            ? 'This repair request has been cancelled.'
            : 'This repair request was not accepted.'}
        </p>
      ) : (
        <ol className="mt-6 space-y-4">
          {REPAIR_STATUS_TIMELINE.map((step, index) => {
            const state =
              index < currentIndex
                ? 'done'
                : index === currentIndex
                  ? 'current'
                  : 'upcoming';
            return (
              <li key={step} className="flex items-center gap-3">
                <span
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-full border',
                    state === 'upcoming'
                      ? 'border-store-border text-store-background-text/40'
                      : getRepairStatusColorClasses(step as RepairStatus)
                  )}
                >
                  {getRepairStatusIcon(step)}
                </span>
                <span
                  className={cn(
                    'text-sm',
                    state === 'current'
                      ? 'font-semibold'
                      : state === 'upcoming'
                        ? 'text-store-background-text/50'
                        : 'text-store-background-text/80'
                  )}
                >
                  {isRepairStatus(step) ? REPAIR_STATUS_LABELS[step] : step}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-6 space-y-1 text-sm text-store-background-text/70">
        <p>
          Service method:{' '}
          {result.serviceType === 'pickup' ? 'Courier pickup' : 'Drop-off'}
        </p>
        {result.serviceType === 'pickup' ? (
          <>
            <p>{getPickupPaymentMessage(result)}</p>
            {result.pickupFee !== null && result.pickupCurrency === 'NGN' ? (
              <p>Pickup fee: ₦{result.pickupFee.toLocaleString()}</p>
            ) : null}
          </>
        ) : null}
        {result.updatedAt ? (
          <p>Last updated: {formatDate(result.updatedAt)}</p>
        ) : null}
      </div>

      {result.trackingNumber && trackHref ? (
        <Link
          className="mt-4 inline-flex items-center gap-1.5 font-medium text-sm text-store-primary underline"
          href={asRoute(trackHref)}
        >
          Track courier pickup ({result.trackingNumber})
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
