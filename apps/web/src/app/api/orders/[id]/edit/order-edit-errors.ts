import { NextResponse } from 'next/server';

export function mapOrderEditError(error: { code?: string; message?: string }) {
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

  if (message.includes('oxygen_financial_edit_locked')) {
    return NextResponse.json(
      {
        code: 'oxygen_financial_edit_locked',
        error:
          'Financial edits are unavailable while Oxygen financing is in progress.',
      },
      { status: 409 }
    );
  }
  if (message.includes('oxygen_order_edit_retry')) {
    return NextResponse.json(
      {
        code: 'oxygen_order_edit_retry',
        error: 'The order is being updated. Please try again.',
      },
      { status: 409 }
    );
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

  if (message.includes('order_terminal_not_editable')) {
    return NextResponse.json(
      {
        code: 'order_not_editable',
        error: 'This order is cancelled or returned and cannot be edited.',
      },
      { status: 409 }
    );
  }

  if (
    message.includes('order_financial_edit_has_payments') ||
    message.includes('order_financial_edit_after_fulfillment') ||
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

  if (message.includes('order_date_in_future')) {
    return NextResponse.json(
      {
        code: 'order_date_in_future',
        error: 'Order date cannot be in the future',
      },
      { status: 400 }
    );
  }

  if (message.includes('order_date_invalid')) {
    return NextResponse.json(
      {
        code: 'order_date_invalid',
        error: 'Invalid order date',
      },
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
