import {
  type OxygenFormDraft,
  oxygenFormDraftSchema,
} from '@baci/shared/oxygen';

/** Input is read only after matching order, customer and merchant ownership. */
export function oxygenOrderPrefill(order: {
  customer_email?: unknown;
  shipping_address?: unknown;
  delivery_method?: unknown;
}): OxygenFormDraft['fields'] {
  const address = order.shipping_address;
  const shipping =
    address && typeof address === 'object' && !Array.isArray(address)
      ? (address as Record<string, unknown>)
      : {};
  const fields: OxygenFormDraft['fields'] = {};
  for (const [field, value] of [
    ['first_name', shipping.firstName],
    ['last_name', shipping.lastName],
    ['email', order.customer_email],
  ] as const) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const parsed = oxygenFormDraftSchema.shape.fields.shape[field].safeParse(
      value.trim()
    );
    if (parsed.success) fields[field] = parsed.data;
  }
  // Only explicit door delivery can suggest a residence. Never a pickup office.
  if (order.delivery_method === 'door') {
    for (const [field, value] of [
      ['home_street', shipping.street || shipping.address],
      ['home_state', shipping.state],
      ['home_city', shipping.city],
      ['home_lga', shipping.lga],
      ['home_house_number', shipping.house_number],
      ['home_landmark', shipping.landmark],
    ] as const) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const parsed = oxygenFormDraftSchema.shape.fields.shape[field].safeParse(
        value.trim()
      );
      if (parsed.success) fields[field] = parsed.data;
    }
  }
  return fields;
}
