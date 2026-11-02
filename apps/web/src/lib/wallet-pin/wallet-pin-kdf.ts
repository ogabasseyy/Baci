import 'server-only';
import { createHash, createHmac, randomBytes, scrypt } from 'node:crypto';
import { walletPinPepperSchema } from '@/schemas/wallet-pin-pepper';

// Wallet PIN key derivation (KDF version 1).
//
// The stored value is scrypt(HMAC-SHA256(pepper, domain || pin), salt). The
// pepper (WALLET_PIN_PEPPER) never leaves the server, so a copy of the
// database alone cannot be used to guess PINs offline. The database keeps
// only the salt and the SHA-256 of the derived hash (so a stored value
// cannot be sent back as if it were the PIN) in a schema no client role
// can read, and it enforces the attempt lockout itself.
//
// Nothing here logs, returns or embeds the PIN or the pepper in an error.

export const WALLET_PIN_KDF_VERSION = 1;

// 4 to 6 ASCII digits. Request schemas may narrow this further.
export const WALLET_PIN_PATTERN = /^[0-9]{4,6}$/;

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const PEPPER_ID_HEX_LENGTH = 16;
// 32 MiB of memory per derivation; maxmem leaves headroom for scrypt's
// bookkeeping so Node does not refuse the parameters.
const SCRYPT_V1 = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;
const PIN_DOMAIN = 'baci.wallet-pin.v1\u0000';
const PEPPER_ID_LABEL = 'baci.wallet-pin.pepper-id.v1';
const ATTESTATION_KEY_LABEL = 'baci.wallet-pin.attestation-key.v1';
const SALT_PATTERN = /^[0-9a-f]{32}$/;
// Visible ASCII only, so the client and the server hash the same bytes.
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

declare const walletPinPepperBrand: unique symbol;

// An opaque handle: it carries only the public id. The key bytes stay in a
// module-private WeakMap, so logging or serialising the handle cannot leak
// the secret.
export type WalletPinPepper = Readonly<{
  id: string;
  [walletPinPepperBrand]: true;
}>;

export type WalletPinPepperState =
  | { readonly status: 'unset' }
  | { readonly status: 'invalid' }
  | { readonly status: 'ready'; readonly pepper: WalletPinPepper };

const pepperKeys = new WeakMap<WalletPinPepper, Buffer>();

function createPepper(secret: string): WalletPinPepper {
  const key = Buffer.from(secret, 'utf8');
  // The id is an HMAC of a fixed label, so it identifies which pepper made a
  // stored hash without revealing anything about the pepper itself. The
  // database compares it to refuse hashes made with a different pepper
  // instead of counting them as wrong PINs.
  const id = createHmac('sha256', key)
    .update(PEPPER_ID_LABEL, 'utf8')
    .digest('hex')
    .slice(0, PEPPER_ID_HEX_LENGTH);
  const pepper = Object.freeze({ id }) as WalletPinPepper;
  pepperKeys.set(pepper, key);
  return pepper;
}

export function readWalletPinPepperState(raw: unknown): WalletPinPepperState {
  if (raw === undefined || raw === null) return { status: 'unset' };
  if (typeof raw === 'string' && raw.trim() === '') return { status: 'unset' };
  const parsed = walletPinPepperSchema.safeParse(raw);
  if (!parsed.success) return { status: 'invalid' };
  return { status: 'ready', pepper: createPepper(parsed.data) };
}

// Request-time reader and the only validator that matters: 'invalid' means
// the PIN routes answer 503. env.ts declares the variable but never fails
// boot on it.
export function getWalletPinPepperState(): WalletPinPepperState {
  return readWalletPinPepperState(process.env.WALLET_PIN_PEPPER);
}

// The key that signs the server's attestation of a derived hash (see
// wallet-pin-attestation.ts). It is a one-way derivative of the pepper, so
// the copy the database holds (wallet_pin_private.attestation_keys, written
// by owner SQL from the enablement runbook) cannot be turned back into the
// pepper or used to derive a PIN hash.
export function deriveWalletPinAttestationKey(pepper: WalletPinPepper): Buffer {
  const key = pepperKeys.get(pepper);
  if (!key) throw new Error('Wallet PIN pepper unavailable');
  return createHmac('sha256', key)
    .update(ATTESTATION_KEY_LABEL, 'utf8')
    .digest();
}

export function createWalletPinSalt(
  randomSource: (size: number) => Buffer = randomBytes
): string {
  const salt = randomSource(SALT_BYTES);
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_BYTES)
    throw new Error('Wallet PIN salt unavailable');
  return salt.toString('hex');
}

function scryptV1(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, HASH_BYTES, SCRYPT_V1, (error, derived) => {
      if (error) reject(new Error('Wallet PIN derivation failed'));
      else resolve(derived);
    });
  });
}

export async function deriveWalletPinHash(input: {
  readonly pin: string;
  readonly salt: string;
  readonly pepper: WalletPinPepper;
}): Promise<string> {
  if (typeof input.pin !== 'string' || !WALLET_PIN_PATTERN.test(input.pin))
    throw new Error('Invalid wallet PIN format');
  if (typeof input.salt !== 'string' || !SALT_PATTERN.test(input.salt))
    throw new Error('Invalid wallet PIN salt');
  const key = pepperKeys.get(input.pepper);
  if (!key) throw new Error('Wallet PIN pepper unavailable');
  const prehash = createHmac('sha256', key)
    .update(`${PIN_DOMAIN}${input.pin}`, 'utf8')
    .digest();
  const derived = await scryptV1(prehash, Buffer.from(input.salt, 'hex'));
  return derived.toString('hex');
}

// A PIN proof is bound to the SHA-256 of the debit's Idempotency-Key. The
// verify route and the debit route must both use this function so they hash
// the same bytes.
export function deriveWalletPinIdempotencyDigest(
  idempotencyKey: string
): string {
  if (
    typeof idempotencyKey !== 'string' ||
    !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  )
    throw new Error('Invalid Idempotency-Key');
  return createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
}
