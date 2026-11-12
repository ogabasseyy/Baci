import { z } from 'zod';

// Same contract as WALLET_PIN_PATTERN in lib/wallet-pin/wallet-pin-kdf.ts:
// 4 to 6 ASCII digits. The pattern is stated here without a message so a
// validation issue never carries the submitted value.
const pin = z.string().regex(/^[0-9]{4,6}$/, 'Invalid PIN');

const lockedUntil = z.string().min(1).max(64);
const attemptsRemaining = z.int().min(0).max(5);

// Requests never carry a merchant or user id: the server derives both.
export const walletPinSchemas = {
  setRequest: z.strictObject({ pin }),
  resetRequest: z.strictObject({ pin }),
  changeRequest: z.strictObject({ currentPin: pin, newPin: pin }),
  pinState: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('set'),
      kdfVersion: z.literal(1),
      salt: z.string().regex(/^[0-9a-f]{32}$/),
      attemptsRemaining,
    }),
    z.strictObject({ status: z.literal('locked'), lockedUntil }),
    z.strictObject({
      status: z.enum(['unavailable', 'not_set', 'reset_required']),
    }),
  ]),
  // has_recent_wallet_pin_sign_in(): a bare boolean.
  recentSignIn: z.boolean(),
  setResult: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.enum([
        'set',
        'already_set',
        'unavailable',
        'reauthentication_required',
      ]),
    }),
  ]),
  changeResult: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('changed') }),
    z.strictObject({ status: z.literal('incorrect'), attemptsRemaining }),
    z.strictObject({ status: z.literal('locked'), lockedUntil }),
    z.strictObject({
      status: z.enum(['not_set', 'reset_required', 'unavailable']),
    }),
  ]),
  resetResult: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.enum([
        'reset',
        'not_set',
        'unavailable',
        'reauthentication_required',
      ]),
    }),
  ]),
};

export type WalletPinState = z.infer<typeof walletPinSchemas.pinState>;
