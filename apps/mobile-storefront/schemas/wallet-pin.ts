import { z } from 'zod';

// Same contract as the server: 4 to 6 ASCII digits. The pattern carries no
// message so a validation issue never echoes the submitted value.
const pin = z.string().regex(/^[0-9]{4,6}$/);

export const WalletPinSchemas = {
  pin,
  // GET /api/storefront/customer/wallet-pin/status. hasPin is only meaningful
  // when available is true.
  status: z.object({
    primary: z.boolean(),
    hasPin: z.boolean(),
    resetRequired: z.boolean(),
    available: z.boolean(),
    // True when setting or resetting a PIN now needs the customer to confirm
    // it's them first (their sign-in is too old). Older servers omit it.
    signInConfirmationRequired: z.boolean().optional(),
  }),
  setRequest: z.object({ pin }).strict(),
  setResponse: z.object({ ok: z.literal(true) }),
  // POST /api/storefront/customer/savings/goal-pin/verify, action 'fund'.
  fundVerifyRequest: z
    .object({
      merchantId: z.uuid(),
      pin,
      action: z.literal('fund'),
      goalId: z.uuid(),
      operationId: z.uuid(),
      amountKobo: z.number().int().positive().max(9999999999),
    })
    .strict(),
  fundVerifyResponse: z.object({
    proof: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: z.string(),
  }),
  // Same route, actions 'cancel' and 'complete': the server moves the whole
  // goal balance, so no amount is ever sent.
  goalActionVerifyRequest: z
    .object({
      merchantId: z.uuid(),
      pin,
      action: z.enum(['cancel', 'complete']),
      goalId: z.uuid(),
      operationId: z.uuid(),
    })
    .strict(),
};
