import type { NextRequest } from 'next/server';
import {
  adminOrderGiglQuoteSchema,
  orderGiglQuoteSchema,
} from '@/schemas/order-gigl-shipping';

export type AdminOrderGiglQuoteInput = {
  admin_order_id: string;
  preview?: boolean;
  receiver?: {
    address: string;
    city?: string;
    state?: string;
    phone: string;
    latitude?: number;
    longitude?: number;
  };
};

export async function resolveAdminOrderGiglQuoteInput(
  request: NextRequest,
  input?: Partial<AdminOrderGiglQuoteInput>
): Promise<AdminOrderGiglQuoteInput | { error: unknown }> {
  let resolvedInput = input;
  if (!resolvedInput?.admin_order_id || resolvedInput.receiver === undefined) {
    const body = await request.json().catch(() => null);
    const headerOrderId = request.headers.get('x-baci-admin-order-id');
    const parsed =
      resolvedInput?.admin_order_id || headerOrderId
        ? orderGiglQuoteSchema.safeParse(body)
        : adminOrderGiglQuoteSchema.safeParse(body);
    if (!parsed.success) {
      return {
        error: {
          error: 'Invalid input',
          details: parsed.error.flatten(),
        },
      };
    }
    const parsedOrderId =
      'admin_order_id' in parsed.data &&
      typeof parsed.data.admin_order_id === 'string'
        ? parsed.data.admin_order_id
        : undefined;
    resolvedInput = {
      admin_order_id:
        resolvedInput?.admin_order_id ?? headerOrderId ?? parsedOrderId ?? '',
      preview: resolvedInput?.preview ?? parsed.data.preview,
      receiver: resolvedInput?.receiver ?? parsed.data.receiver,
    };
  }

  const validatedInput = adminOrderGiglQuoteSchema.safeParse(resolvedInput);
  if (!validatedInput.success) {
    return {
      error: {
        error: 'Invalid input',
        details: validatedInput.error.flatten(),
      },
    };
  }

  return validatedInput.data;
}
