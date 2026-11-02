import z from 'zod';

// WALLET_PIN_PEPPER is the server-only HMAC key mixed into every wallet PIN
// hash (see lib/wallet-pin/wallet-pin-kdf.ts). Unset means no PIN can be set
// or verified. Messages never echo the value.
export const WALLET_PIN_PEPPER_MIN_LENGTH = 32;
export const WALLET_PIN_PEPPER_MAX_LENGTH = 512;
export const WALLET_PIN_PEPPER_MIN_DISTINCT_CHARACTERS = 10;

export const walletPinPepperSchema = z
  .string()
  .trim()
  .min(WALLET_PIN_PEPPER_MIN_LENGTH, {
    message: 'WALLET_PIN_PEPPER must be at least 32 characters',
  })
  .max(WALLET_PIN_PEPPER_MAX_LENGTH, {
    message: 'WALLET_PIN_PEPPER must be at most 512 characters',
  })
  .refine(
    (value) => new Set(value).size >= WALLET_PIN_PEPPER_MIN_DISTINCT_CHARACTERS,
    {
      message:
        'WALLET_PIN_PEPPER must be generated randomly (too few distinct characters)',
    }
  );

// env.ts entry. The PIN feature is optional and ships dark, so this never
// fails boot: blank and unusable values both read as unset, and a bad value
// switches off only the PIN routes, which read the variable through
// getWalletPinPepperState() (lib/wallet-pin/wallet-pin-kdf.ts) and answer
// 503. A failing env.ts entry would instead take down every page that
// imports @/env.
export const walletPinPepperEnvSchema = z.preprocess((value) => {
  const parsed = walletPinPepperSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}, walletPinPepperSchema.optional());
