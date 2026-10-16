import type { GPTLineItem, GPTTotal } from '@/lib/agentic/checkout';
import type { UcpCartInternalStatus } from '@/lib/agentic/ucp-cart-storage';
import { UCP_PROFILE_VERSION } from '@/lib/agentic/ucp-discovery-profile';

const UCP_CART_CAPABILITY = 'dev.ucp.shopping.cart';

export function buildUcpCartResponse({
  cartId,
  continueUrl,
  currency,
  lineItems,
  status,
  totals,
}: {
  cartId: string;
  continueUrl?: string | null;
  currency: string;
  lineItems: GPTLineItem[];
  status: UcpCartInternalStatus;
  totals: GPTTotal[];
}) {
  return {
    // Optional per the UCP cart contract: omit rather than emit an
    // empty unusable continuation when no handoff was issued.
    ...(continueUrl ? { continue_url: continueUrl } : {}),
    currency: currency.toUpperCase(),
    id: cartId,
    line_items: lineItems.map((lineItem) => ({
      id: lineItem.id,
      item: {
        id: lineItem.item.id,
        product_id: lineItem.item.product_id,
        title: lineItem.item.title ?? lineItem.item.id,
        ...(lineItem.item.variant_id
          ? { variant_id: lineItem.item.variant_id }
          : {}),
        ...(lineItem.item.variant_attributes
          ? { variant_attributes: lineItem.item.variant_attributes }
          : {}),
        ...(lineItem.item.condition
          ? { condition: lineItem.item.condition }
          : {}),
      },
      quantity: lineItem.item.quantity,
      totals: [
        {
          amount: lineItem.subtotal,
          display_text: 'Subtotal',
          type: 'subtotal' as const,
        },
        {
          amount: lineItem.total,
          display_text: 'Total',
          type: 'total' as const,
        },
      ],
    })),
    status,
    totals,
    ucp: {
      version: UCP_PROFILE_VERSION,
      status: 'success',
      capabilities: {
        [UCP_CART_CAPABILITY]: [{ version: UCP_PROFILE_VERSION }],
      },
    },
  };
}
