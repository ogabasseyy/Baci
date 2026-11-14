import { z } from 'zod';
import { WalletPinSchemas } from './wallet-pin';

// POST /api/storefront/customer/wallet-pin/change. Strict on purpose: the
// server derives merchant and user, so no other key may ever be sent. The PIN
// pattern carries no message, so an issue never echoes a submitted value.
export const WalletPinChangeSchemas = {
  request: z
    .object({ currentPin: WalletPinSchemas.pin, newPin: WalletPinSchemas.pin })
    .strict(),
  response: z.object({ ok: z.literal(true) }),
};
