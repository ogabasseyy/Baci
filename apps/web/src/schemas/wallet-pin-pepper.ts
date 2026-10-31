import z from 'zod';

// WALLET_PIN_PEPPER is the server-only HMAC key mixed into every wallet PIN
// hash (see lib/wallet-pin/wallet-pin-kdf.ts). Unset means no PIN can be set
// or verified. Messages never echo the value.
export const WALLET_PIN_PEPPER_MIN_LENGTH = 32;
export const WALLET_PIN_PEPPER_MAX_LENGTH = 512;

export const walletPinPepperSchema = z
  .string()
  .trim()
  .min(WALLET_PIN_PEPPER_MIN_LENGTH, {
    message: 'WALLET_PIN_PEPPER must be at least 32 characters',
  })
  .max(WALLET_PIN_PEPPER_MAX_LENGTH, {
    message: 'WALLET_PIN_PEPPER must be at most 512 characters',
  });

// env.ts entry: blank is the same as unset; a set value must be usable.
export const walletPinPepperEnvSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || undefined;
}, walletPinPepperSchema.optional());
