import z from 'zod';

const order = z.object({
  id: z.uuid(),
  order_number: z.string().max(100).nullish(),
  payment_status: z.string().max(80).nullable(),
  shipping_status: z.string().max(80).nullable(),
});

/** Only the fields needed by account controls are retained from the response. */
export const storefrontChatAccountSchemas = {
  orders: z.object({ orders: z.array(order) }),
  cancellation: z.object({ success: z.literal(true), cancelled: z.boolean() }),
};

export type StorefrontChatOrder = z.infer<typeof order>;
