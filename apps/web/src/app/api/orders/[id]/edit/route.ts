import {
  MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY,
  normalizeOrderEditChangeCategory,
  shouldNotifyCustomerForOrderEdit,
} from '@baci/shared';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { sendOrderUpdatedEmail } from '@/lib/order-update-email';
import { adminOrderEditSchema } from '@/schemas/admin-order-edit';

const paramsSchema = z.object({
  id: z.uuid(),
});

interface OrderEditRpcResult {
  change_category?: string;
  changed_fields?: string[];
  customer_email?: string | null;
  merchant_id?: string;
  notify_customer?: boolean;
  order_id?: string;
}

function mapOrderEditError(error: { code?: string; message?: string }) {
  const message = error.message ?? 'Failed to update order';

  if (message.includes('order_not_found')) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  if (
    message.includes('order_item_product_forbidden') ||
    message.includes('order_item_variant_forbidden')
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (message.includes('order_item_append_supports_one_new_line')) {
    return NextResponse.json(
      {
        code: 'order_item_append_limit',
        error: 'Add only one new item per edit.',
      },
      { status: 409 }
    );
  }

  if (message.includes('order_edit_forbidden') || error.code === '42501') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (message.includes('active_shipping_charge_quote_input_edit_blocked')) {
    return NextResponse.json(
      {
        code: 'active_shipping_charge_quote_input_edit_blocked',
        error:
          'Shipping quote inputs cannot change while a wallet shipping charge is active.',
      },
      { status: 409 }
    );
  }

  if (message.includes('active_shipping_charge_address_edit_blocked')) {
    return NextResponse.json(
      {
        code: 'active_shipping_charge_address_edit_blocked',
        error:
          'Shipping address cannot change while a wallet shipping charge is active.',
      },
      { status: 409 }
    );
  }

  if (
    message.includes('order_financial_edit_has_payments') ||
    message.includes('order_financial_edit_after_fulfillment') ||
    message.includes('order_terminal_not_editable') ||
    message.includes('order_item_replacement_has_historical_state') ||
    message.includes('order_item_replacement_has_accounting_metadata') ||
    message.includes('order_item_replacement_has_managed_stock') ||
    message.includes('order_item_replacement_has_serialized_reservations') ||
    message.includes(
      'cannot_delete_order_item_with_historical_serialized_units'
    ) ||
    message.includes(
      'cannot_delete_order_item_with_historical_inventory_events'
    )
  ) {
    const hasProtectedLineItemHistory = message.includes(
      'order_item_replacement_has_accounting_metadata'
    );

    return NextResponse.json(
      {
        code: 'order_not_editable',
        error: hasProtectedLineItemHistory
          ? 'This order contains protected line-item history. Existing items cannot be changed or removed.'
          : 'This order has payments or fulfillment history. Financial edits are locked.',
      },
      { status: 409 }
    );
  }

  if (message.includes('order_total_negative')) {
    return NextResponse.json(
      { error: 'Discount cannot exceed the order total' },
      { status: 400 }
    );
  }

  if (
    message.includes('branch_not_found') ||
    message.includes('customer_not_found') ||
    message.includes('branch_id_invalid') ||
    message.includes('customer_id_invalid') ||
    message.includes('order_required_fields_invalid') ||
    message.includes('order_notify_customer_invalid') ||
    message.includes('order_money_invalid') ||
    message.includes('order_item_values_invalid') ||
    message.includes('order_item_product_invalid') ||
    message.includes('order_item_variant_invalid') ||
    message.includes('order_item_product_required')
  ) {
    return NextResponse.json({ error: 'Invalid order scope' }, { status: 400 });
  }

  return NextResponse.json(
    { error: 'Failed to update order' },
    { status: 500 }
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = auth.supabase;

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const paramsResult = paramsSchema.safeParse(await context.params);
  if (!paramsResult.success) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }

  const parsed = adminOrderEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc(
    'update_admin_order_with_transaction_discount_metadata',
    {
      p_order_id: paramsResult.data.id,
      p_payload: parsed.data,
    }
  );

  if (error) {
    return mapOrderEditError(error);
  }

  const result = data as OrderEditRpcResult;
  const changeCategory = normalizeOrderEditChangeCategory(
    result.change_category
  );

  if (
    shouldNotifyCustomerForOrderEdit({
      change_category: changeCategory,
      notify_customer: result.notify_customer,
    })
  ) {
    after(async () => {
      try {
        const emailResult = await sendOrderUpdatedEmail({
          changeCategory: changeCategory ?? 'customer_visible',
          changedFields: Array.isArray(result.changed_fields)
            ? result.changed_fields
            : [],
          orderId: result.order_id ?? paramsResult.data.id,
          supabase,
        });

        if (!emailResult.success) {
          logger.warn({
            error: emailResult.error,
            message: 'Order edit email was not sent',
            orderId: result.order_id ?? paramsResult.data.id,
          });
        }
      } catch (error) {
        logger.error({
          error,
          message: 'Order edit email scheduling failed',
          orderId: result.order_id ?? paramsResult.data.id,
        });
      }
    });
  }

  const { data: updatedOrder, error: updatedOrderError } = await supabase
    .from('orders')
    .select(MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY)
    .eq('id', paramsResult.data.id)
    .eq('merchant_id', result.merchant_id ?? '')
    .single();

  if (updatedOrderError || !updatedOrder) {
    logger.warn({
      error: updatedOrderError,
      message: 'Order edit committed but refreshed order fetch failed',
      orderId: result.order_id ?? paramsResult.data.id,
    });

    return NextResponse.json({
      edit: data,
      order: {
        id: result.order_id ?? paramsResult.data.id,
      },
      order_refresh_failed: true,
    });
  }

  const normalizedOrder = updatedOrder as Record<string, unknown> & {
    items?: unknown[];
    order_items?: unknown[];
  };
  const {
    items: orderItems,
    order_items: legacyOrderItems,
    ...orderFields
  } = normalizedOrder;

  return NextResponse.json({
    edit: data,
    order: {
      ...orderFields,
      items: orderItems ?? legacyOrderItems ?? [],
    },
  });
}
