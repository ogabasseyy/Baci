import 'server-only';
import { createHmac } from 'node:crypto';
import {
  deriveWalletPinAttestationKey,
  WALLET_PIN_KDF_VERSION,
  type WalletPinPepper,
} from './wallet-pin-kdf';

// Server attestation of a wallet PIN request.
//
// The customer PIN functions are granted to the authenticated role, so a
// signed-in customer can call them straight through the API with a hash of
// their own choosing. To keep the database from trusting such a hash, every
// set, change, reset and verify carries '<attested_at_ms>.<hex HMAC>' made
// here, after the server derived the hash. The database recomputes it with
// the key it holds for the pepper (wallet_pin_private.require_attestation)
// and refuses anything it cannot reproduce, is for another caller, merchant,
// operation or request, or is older than two minutes.
//
// The signed message is these lines joined by '\n':
//   baci.wallet-pin.attestation.v1, operation, user id, merchant id,
//   pepper id, attested_at_ms, then the operation's fields (below).
// The user id is the signed-in customer's auth user, so an attestation
// cannot be handed to another account. Nothing here logs, returns or embeds
// the PIN, the pepper or the key.

const ATTESTATION_DOMAIN = 'baci.wallet-pin.attestation.v1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SALT_PATTERN = /^[0-9a-f]{32}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
// Same domain as wallet_pin_private.proof_purposes' CHECK.
const PURPOSE_PATTERN = /^[a-z][a-z_]{1,31}$/;
const MAX_AMOUNT_KOBO = 9_999_999_999;
// 13-digit epoch milliseconds, the only form the database accepts.
const MIN_ATTESTED_AT_MS = 1e12;
const MAX_ATTESTED_AT_MS = 1e13 - 1;

export type WalletPinAttestationRequest =
  | {
      readonly operation: 'set' | 'reset';
      readonly salt: string;
      readonly pinHash: string;
    }
  | {
      readonly operation: 'change';
      readonly currentPinHash: string;
      readonly salt: string;
      readonly pinHash: string;
    }
  | {
      readonly operation: 'verify';
      readonly pinHash: string;
      readonly purpose: string;
      readonly amountKobo: number;
      readonly idempotencyKeySha256: string;
    };

export type WalletPinAttestationInput = {
  readonly pepper: WalletPinPepper;
  // The signed-in customer's auth user id and the storefront's merchant id,
  // lower-case UUIDs as the database renders them.
  readonly userId: string;
  readonly merchantId: string;
  // Date.now() when the route signs; the database accepts it for two minutes.
  readonly attestedAtMs: number;
  readonly request: WalletPinAttestationRequest;
};

function invalid(): never {
  throw new Error('Invalid wallet PIN attestation input');
}

function requirePattern(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) invalid();
  return value;
}

// The operation's fields, in the order wallet_pin_private.require_attestation
// receives them from each customer function.
function requestFields(request: WalletPinAttestationRequest): string[] {
  const version = String(WALLET_PIN_KDF_VERSION);
  switch (request.operation) {
    case 'set':
    case 'reset':
      return [
        version,
        requirePattern(request.salt, SALT_PATTERN),
        requirePattern(request.pinHash, SHA256_HEX_PATTERN),
      ];
    case 'change':
      return [
        requirePattern(request.currentPinHash, SHA256_HEX_PATTERN),
        version,
        requirePattern(request.salt, SALT_PATTERN),
        requirePattern(request.pinHash, SHA256_HEX_PATTERN),
      ];
    case 'verify': {
      const amount = request.amountKobo;
      if (
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > MAX_AMOUNT_KOBO
      )
        invalid();
      return [
        requirePattern(request.pinHash, SHA256_HEX_PATTERN),
        requirePattern(request.purpose, PURPOSE_PATTERN),
        String(amount),
        requirePattern(request.idempotencyKeySha256, SHA256_HEX_PATTERN),
      ];
    }
    default:
      return invalid();
  }
}

export function signWalletPinAttestation(
  input: WalletPinAttestationInput
): string {
  const atMs = input.attestedAtMs;
  if (
    !Number.isInteger(atMs) ||
    atMs < MIN_ATTESTED_AT_MS ||
    atMs > MAX_ATTESTED_AT_MS
  )
    invalid();
  const message = [
    ATTESTATION_DOMAIN,
    input.request.operation,
    requirePattern(input.userId, UUID_PATTERN),
    requirePattern(input.merchantId, UUID_PATTERN),
    input.pepper.id,
    String(atMs),
    ...requestFields(input.request),
  ].join('\n');
  const mac = createHmac('sha256', deriveWalletPinAttestationKey(input.pepper))
    .update(message, 'utf8')
    .digest('hex');
  return `${atMs}.${mac}`;
}
