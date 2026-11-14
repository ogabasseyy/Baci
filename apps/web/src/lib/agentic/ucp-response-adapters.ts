import { NextResponse } from 'next/server';
import type { GPTTotal } from '@/lib/agentic/checkout';
import { mapUcpCheckoutLineItem } from '@/lib/agentic/ucp-checkout-line-item-adapter';
import { UCP_PROFILE_VERSION } from '@/lib/agentic/ucp-discovery-profile';
import { mapUcpOrderLineItem } from '@/lib/agentic/ucp-order-line-item-adapter';

const UCP_CHECKOUT_CAPABILITY = 'dev.ucp.shopping.checkout';
const UCP_ORDER_CAPABILITY = 'dev.ucp.shopping.order';
type JsonRecord = Record<string, unknown>;

export function adaptCheckoutResponseToUcp(response: Response) {
  return adaptJsonResponse(response, buildUcpCheckoutResponse, {
    capability: UCP_CHECKOUT_CAPABILITY,
  });
}

export function adaptOrderResponseToUcp(response: Response) {
  return adaptJsonResponse(response, buildUcpOrderResponse, {
    capability: UCP_ORDER_CAPABILITY,
  });
}

export function buildUcpCheckoutResponse(response: unknown) {
  if (!isRecord(response)) return response;

  return {
    ...response,
    ucp: {
      version: UCP_PROFILE_VERSION,
      status: 'success',
      capabilities: {
        [UCP_CHECKOUT_CAPABILITY]: [{ version: UCP_PROFILE_VERSION }],
      },
      payment_handlers: {},
    },
    status: mapCheckoutStatus(response.status),
    line_items: Array.isArray(response.line_items)
      ? response.line_items.map(mapUcpCheckoutLineItem)
      : [],
    totals: mapCheckoutTotals(response.totals),
  };
}

export function buildUcpOrderResponse(response: unknown) {
  if (!isRecord(response)) return response;

  const currency = toStringValue(response.currency)?.toUpperCase() ?? 'NGN';
  const total = toIntegerAmount(response.total);
  const subtotal = toIntegerAmount(response.subtotal) ?? total ?? 0;
  const shippingFee = toIntegerAmount(response.shipping_fee);
  const taxAmount = toIntegerAmount(response.tax_amount);
  const discountAmount = toIntegerAmount(response.discount_amount);
  const orderId = toStringValue(response.id) ?? 'unknown';
  const shippingStatus = toStringValue(response.shipping_status);
  const lineItems = Array.isArray(response.order_items)
    ? response.order_items.map((item, index) =>
        mapUcpOrderLineItem(item, index, shippingStatus)
      )
    : [];
  const fulfillmentEvents = shippingStatus
    ? [
        {
          id: `event_${orderId}_${shippingStatus}`,
          line_items: lineItems.map((lineItem, index) => ({
            id: toStringValue(lineItem.id) ?? `line_item_${index}`,
            quantity:
              toNonNegativeInteger(getRecord(lineItem.quantity)?.fulfilled) ??
              toPositiveInteger(getRecord(lineItem.quantity)?.total) ??
              1,
          })),
          occurred_at:
            toStringValue(response.updated_at) ?? new Date(0).toISOString(),
          type: shippingStatus,
        },
      ]
    : [];

  return {
    ...response,
    ucp: {
      version: UCP_PROFILE_VERSION,
      status: 'success',
      capabilities: {
        [UCP_ORDER_CAPABILITY]: [{ version: UCP_PROFILE_VERSION }],
      },
    },
    checkout_id: toStringValue(response.checkout_id) ?? orderId ?? 'unknown',
    currency,
    id: orderId,
    fulfillment: {
      expectations: [],
      events: fulfillmentEvents,
    },
    line_items: lineItems,
    permalink_url:
      toStringValue(response.permalink_url) ??
      toStringValue(getRecord(response.links)?.track_order) ??
      '',
    totals: buildOrderTotals({
      discountAmount,
      shippingFee,
      subtotal,
      taxAmount,
      total: total ?? subtotal,
    }),
  };
}

async function adaptJsonResponse(
  response: Response,
  adapter: (body: unknown) => unknown,
  {
    capability,
  }: {
    capability: string;
  }
): Promise<Response> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');

  if (response.status < 200 || response.status >= 300) {
    return NextResponse.json(
      buildUcpErrorResponse(body, {
        capability,
        statusCode: response.status,
      }),
      {
        headers,
        status: response.status,
      }
    );
  }

  return NextResponse.json(adapter(body), {
    headers,
    status: response.status,
  });
}

function mapCheckoutStatus(status: unknown): string {
  switch (status) {
    case 'not_ready_for_payment':
      return 'incomplete';
    case 'ready_for_payment':
      return 'ready_for_complete';
    case 'payment_pending':
      return 'complete_in_progress';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'canceled';
    default:
      return 'requires_escalation';
  }
}

function mapCheckoutTotals(totals: unknown): unknown[] {
  const sourceTotals = Array.isArray(totals)
    ? totals.filter((total): total is GPTTotal => isRecord(total))
    : [];
  const mappedTotals = sourceTotals
    .map((total) => ({
      ...total,
      amount: toIntegerAmount(total.amount) ?? 0,
      type: total.type === 'items_base_amount' ? 'subtotal' : total.type,
    }))
    .filter((total) => total.type !== 'items_discount' || total.amount < 0);
  const hasSubtotal = mappedTotals.some((total) => total.type === 'subtotal');
  const hasTotal = mappedTotals.some((total) => total.type === 'total');

  if (!hasSubtotal) {
    mappedTotals.unshift({
      amount: 0,
      display_text: 'Subtotal',
      type: 'subtotal',
    });
  }
  if (!hasTotal) {
    mappedTotals.push({ amount: 0, display_text: 'Total', type: 'total' });
  }

  return mappedTotals;
}

function buildUcpErrorResponse(
  body: unknown,
  {
    capability,
    statusCode,
  }: {
    capability: string;
    statusCode: number;
  }
) {
  const bodyRecord = isRecord(body) ? body : {};
  const messages = toUcpErrorMessages(bodyRecord, statusCode);

  return {
    ...bodyRecord,
    messages,
    ucp: {
      version: UCP_PROFILE_VERSION,
      status: 'error',
      capabilities: {
        [capability]: [{ version: UCP_PROFILE_VERSION }],
      },
    },
  };
}

function toUcpErrorMessages(body: JsonRecord, statusCode: number) {
  const existingMessages = Array.isArray(body.messages)
    ? body.messages.filter(isRecord)
    : [];
  if (existingMessages.length > 0) {
    return existingMessages.map((message) => ({
      ...message,
      content:
        toStringValue(message.content) ??
        toStringValue(message.message) ??
        `Request failed with status ${statusCode}`,
      content_type: toStringValue(message.content_type) ?? 'plain',
      type: toStringValue(message.type) ?? 'error',
    }));
  }

  const fallbackContent =
    toStringValue(body.error) ??
    toStringValue(body.message) ??
    `Request failed with status ${statusCode}`;
  const fallbackCode =
    toStringValue(body.code) ?? toStringValue(body.details) ?? undefined;

  return [
    {
      ...(fallbackCode ? { code: fallbackCode } : {}),
      content: fallbackContent,
      content_type: 'plain',
      type: 'error',
    },
  ];
}

function buildOrderTotals({
  discountAmount,
  shippingFee,
  subtotal,
  taxAmount,
  total,
}: {
  discountAmount?: number | null;
  shippingFee?: number | null;
  subtotal: number;
  taxAmount?: number | null;
  total: number;
}) {
  return [
    {
      amount: Math.max(0, subtotal),
      display_text: 'Subtotal',
      type: 'subtotal',
    },
    ...(shippingFee && shippingFee > 0
      ? [{ amount: shippingFee, display_text: 'Shipping', type: 'fulfillment' }]
      : []),
    ...(taxAmount && taxAmount > 0
      ? [{ amount: taxAmount, display_text: 'Tax', type: 'tax' }]
      : []),
    ...(discountAmount && discountAmount > 0
      ? [
          {
            amount: -Math.abs(discountAmount),
            display_text: 'Discount',
            type: 'discount',
          },
        ]
      : []),
    { amount: Math.max(0, total), display_text: 'Total', type: 'total' },
  ];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function toIntegerAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function toPositiveInteger(value: unknown): number | null {
  const amount = toIntegerAmount(value);
  return amount && amount > 0 ? amount : null;
}

function toNonNegativeInteger(value: unknown): number | null {
  const amount = toIntegerAmount(value);
  return amount !== null && amount >= 0 ? amount : null;
}
