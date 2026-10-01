import { z } from 'zod';

/**
 * Checkout delivery metadata used to identify local airport pricing at the
 * orders route boundary. A selected quote identifies provider-backed airport
 * delivery; otherwise airport_type is required for the fixed local fee.
 */
export const orderDeliveryMetadataSchema = z
  .object({
    selected_quote_id: z.uuid().nullable().optional(),
    delivery_method: z
      .enum(['pickup', 'door', 'airport', 'pickup_station'])
      .optional(),
    airport_type: z.enum(['delivery', 'pickup']).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.delivery_method === 'airport' &&
      !data.selected_quote_id &&
      data.airport_type === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Airport type is required for local airport delivery',
        path: ['airport_type'],
      });
    }

    if (
      data.delivery_method === 'airport' &&
      data.selected_quote_id &&
      data.airport_type === 'pickup'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provider-backed airport delivery only supports delivery',
        path: ['airport_type'],
      });
    }

    if (data.delivery_method !== 'airport' && data.airport_type !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Airport type is only valid for airport delivery',
        path: ['airport_type'],
      });
    }
  });
