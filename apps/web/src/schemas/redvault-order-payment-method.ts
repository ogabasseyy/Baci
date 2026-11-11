import { z } from 'zod';

/**
 * Rows returned by the `get_redvault_order_payment_method` RPC. An empty array
 * means the order is missing or bound to another merchant; a row with a NULL
 * payment method is an order that was never routed through REDVAULT.
 */
export const redvaultOrderPaymentMethodRowsSchema = z.array(
  z.object({ payment_method: z.string().nullable() })
);
