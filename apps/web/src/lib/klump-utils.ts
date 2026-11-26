import { computeOrderNetPayable } from '@baci/shared/lib';

export interface BnplOrderItem {
  name?: string;
  product_name?: string;
  price: number;
  quantity: number;
}

export interface BnplOrder {
  id: string;
  total: number | string;
  amount_paid?: number | string | null;
  wallet_amount_used?: number | string | null;
  wallet_ledger_used?: number | string | null;
  savings_ledger_used?: number | string | null;
  wallet_reversal_completed?: boolean | null;
  wallet_reversed_credit?: number | string | null;
  payment_status?: string | null;
  currency?: string | null;
  order_number?: string | null;
  shipping_cost?: number | string | null;
  shipping_fee?: number | string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  tracking_token?: string | null;
  items: BnplOrderItem[];
}

export function normalizeKlumpPhone(phone: string | null | undefined) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('234')) {
    const localDigits = digits.slice(3);
    if (localDigits.length === 10) {
      return `0${localDigits}`;
    }
    if (localDigits.length === 11 && localDigits.startsWith('0')) {
      return localDigits;
    }
  }
  if (digits.length === 10) {
    return `0${digits}`;
  }
  if (digits.length === 11) {
    return digits;
  }

  return phone?.trim() || undefined;
}

export function getUnmaskedValue(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !trimmed.includes('*')) {
      return trimmed;
    }
  }

  return undefined;
}

export function toCurrencyAmount(value: number | string | null | undefined) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return Math.round(amount * 100) / 100;
}

/**
 * Net remaining amount due to the BNPL gateway after subtracting any pre-gateway
 * store credit (wallet or device savings) recorded on the order.
 */
export function getBnplRemainingAmount(
  order: Pick<
    BnplOrder,
    | 'total'
    | 'amount_paid'
    | 'wallet_amount_used'
    | 'wallet_ledger_used'
    | 'savings_ledger_used'
    | 'wallet_reversal_completed'
    | 'wallet_reversed_credit'
    | 'payment_status'
  >
) {
  const normalizedStatus = (order.payment_status ?? 'unpaid')
    .trim()
    .toLowerCase();
  if (
    normalizedStatus === 'paid' ||
    normalizedStatus === 'bnpl_approved' ||
    normalizedStatus === 'refunded' ||
    normalizedStatus === 'cancelled' ||
    normalizedStatus === 'canceled'
  ) {
    return 0;
  }

  const hasLedgerProjection =
    order.wallet_ledger_used != null || order.savings_ledger_used != null;
  const effectiveStatus = !hasLedgerProjection
    ? 'unpaid'
    : order.payment_status;

  return toCurrencyAmount(
    computeOrderNetPayable({
      total: toCurrencyAmount(order.total),
      amountPaid: toCurrencyAmount(order.amount_paid),
      walletAmountUsed: toCurrencyAmount(order.wallet_amount_used),
      walletLedgerUsed: toCurrencyAmount(order.wallet_ledger_used),
      savingsLedgerUsed: toCurrencyAmount(order.savings_ledger_used),
      walletReversalCompleted: order.wallet_reversal_completed === true,
      walletReversedCredit:
        order.wallet_reversed_credit != null
          ? toCurrencyAmount(order.wallet_reversed_credit)
          : undefined,
      paymentStatus: effectiveStatus,
    })
  );
}

export function toKlumpIntegerAmount(
  value: number | string | null | undefined
) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  // Klump requires integer NGN amounts; ceiling avoids settling an order after a fractional underpayment.
  return Math.ceil(amount);
}

export function buildKlumpItems(order: BnplOrder) {
  const items = order.items.flatMap((item) => {
    const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
    const unitPrice = toKlumpIntegerAmount(item.price);
    const roundedLineTotal = toKlumpIntegerAmount(
      Number(item.price) * quantity
    );
    const canRepresentQuantity = unitPrice * quantity === roundedLineTotal;
    if (unitPrice === 0) {
      return roundedLineTotal > 0
        ? [
            {
              name: item.product_name || item.name || 'Order item',
              quantity: 1,
              unit_price: roundedLineTotal,
            },
          ]
        : [];
    }

    return [
      {
        name: item.product_name || item.name || 'Order item',
        quantity: canRepresentQuantity ? quantity : 1,
        unit_price: canRepresentQuantity ? unitPrice : roundedLineTotal,
      },
    ];
  });
  const itemsTotal = () =>
    items.reduce((total, item) => total + item.unit_price * item.quantity, 0);
  const shippingFee = toKlumpIntegerAmount(
    order.shipping_cost ?? order.shipping_fee
  );

  if (shippingFee > 0) {
    items.push({
      name: 'Delivery',
      quantity: 1,
      unit_price: shippingFee,
    });
  }

  const targetTotal = toKlumpIntegerAmount(getBnplRemainingAmount(order));
  let excess = itemsTotal() - targetTotal;
  for (let index = items.length - 1; index >= 0 && excess > 0; index -= 1) {
    const item = items[index];
    if (!item) continue;

    const lineTotal = item.unit_price * item.quantity;
    const reduction = Math.min(lineTotal - 1, excess);
    if (reduction <= 0) continue;

    item.quantity = 1;
    item.unit_price = lineTotal - reduction;
    excess -= reduction;
  }

  for (let index = items.length - 1; index >= 0 && excess > 0; index -= 1) {
    const item = items[index];
    if (!item) continue;

    const lineTotal = item.unit_price * item.quantity;
    const reduction = Math.min(lineTotal, excess);
    if (reduction <= 0) continue;

    item.quantity = 1;
    item.unit_price = lineTotal - reduction;
    excess -= reduction;
  }

  const adjustment = targetTotal - itemsTotal();
  if (adjustment > 0) {
    items.push({
      name: 'Taxes and fees',
      quantity: 1,
      unit_price: adjustment,
    });
  }

  return items.filter((item) => item.quantity > 0 && item.unit_price > 0);
}
