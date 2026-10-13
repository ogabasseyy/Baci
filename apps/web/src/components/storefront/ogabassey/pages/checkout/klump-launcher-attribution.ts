import type { BnplOrder } from '@/lib/klump-utils';
import { captureBnplPaymentFailed } from './capture-bnpl-payment-failed';
import { captureBnplPaymentStarted } from './capture-bnpl-payment-started';

interface KlumpLauncherAttribution {
  order: BnplOrder;
  reference?: string;
}

function toVerifiedAmount(order: BnplOrder): {
  value?: number;
  currency?: string;
} {
  const total = Number(order.total);
  const currency =
    typeof order.currency === 'string' && order.currency.trim()
      ? order.currency.trim()
      : undefined;
  return {
    ...(Number.isFinite(total) ? { value: total } : {}),
    ...(currency ? { currency } : {}),
  };
}

/**
 * Deferred web start for the Klump widget, recorded from onOpen (browser
 * sessions only; the started helper no-ops inside native shells, which
 * attribute from the provider-opened bridge instead). Extracted from
 * bnpl-launcher.tsx (300-line file limit).
 */
export function captureKlumpLauncherStarted({
  order,
  reference,
}: KlumpLauncherAttribution): void {
  captureBnplPaymentStarted({
    orderId: order.id,
    orderNumber: order.order_number ?? undefined,
    paymentMethod: 'klump',
    reference,
    ...toVerifiedAmount(order),
  });
}

/**
 * Web failure for an opened-then-failed Klump attempt. Browser sessions
 * have no native shell to attribute the failure, and checkout already
 * navigated away — without this the onOpen start strands unmatched.
 */
export function captureKlumpLauncherFailed({
  order,
  reference,
}: KlumpLauncherAttribution): void {
  captureBnplPaymentFailed({
    orderId: order.id,
    orderNumber: order.order_number ?? undefined,
    paymentMethod: 'klump',
    reason: 'klump_error',
    reference,
    ...toVerifiedAmount(order),
  });
}
