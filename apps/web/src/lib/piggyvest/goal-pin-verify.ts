import 'server-only';
import { signWalletPinAttestation } from '@/lib/wallet-pin/wallet-pin-attestation';
import {
  deriveWalletPinHash,
  getWalletPinPepperState,
} from '@/lib/wallet-pin/wallet-pin-kdf';
import { piggyvestGoalPinSchemas } from '@/schemas/piggyvest-goal-pin';
import type { GoalPinBinding } from './goal-pin-binding';

type Rpc = (
  name: 'get_wallet_pin_state' | 'verify_wallet_pin',
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: unknown }>;

export type GoalPinVerification =
  | { status: 'verified'; proof: string; expiresAt: string }
  | { status: 'incorrect'; attemptsRemaining: number }
  | { status: 'locked'; lockedUntil: string }
  | {
      status: 'unavailable' | 'not_set' | 'reset_required' | 'too_many_proofs';
    };

/**
 * Checks one PIN attempt for a goal action and returns the single-use proof.
 * The database owns lockout (5 wrong PINs lock 30 minutes, doubling, capped
 * at 24 hours); this only hashes with the server pepper, signs the request
 * and maps the answer. It never logs or returns the PIN or the pepper, and
 * any unexpected database answer throws instead of passing.
 */
export async function verifyGoalPin(input: {
  rpc: Rpc;
  userId: string;
  merchantId: string;
  pin: string;
  binding: GoalPinBinding;
  now: () => number;
}): Promise<GoalPinVerification> {
  const pepper = getWalletPinPepperState();
  if (pepper.status !== 'ready') return { status: 'unavailable' };
  const pepperId = pepper.pepper.id;

  const stateResult = await input.rpc('get_wallet_pin_state', {
    p_merchant_id: input.merchantId,
    p_pepper_id: pepperId,
  });
  if (stateResult.error) throw new Error('Wallet PIN state unavailable');
  const state = piggyvestGoalPinSchemas.pinState.parse(stateResult.data);
  if (state.status !== 'set') return state;

  const pinHash = await deriveWalletPinHash({
    pin: input.pin,
    salt: state.salt,
    pepper: pepper.pepper,
  });
  const attestation = signWalletPinAttestation({
    pepper: pepper.pepper,
    userId: input.userId,
    merchantId: input.merchantId,
    attestedAtMs: input.now(),
    request: {
      operation: 'verify',
      pinHash,
      purpose: input.binding.purpose,
      amountKobo: input.binding.amountKobo,
      idempotencyKeySha256: input.binding.idempotencyKeySha256,
    },
  });
  const verifyResult = await input.rpc('verify_wallet_pin', {
    p_merchant_id: input.merchantId,
    p_pepper_id: pepperId,
    p_pin_hash: pinHash,
    p_purpose: input.binding.purpose,
    p_amount_kobo: input.binding.amountKobo,
    p_idempotency_key_sha256: input.binding.idempotencyKeySha256,
    p_attestation: attestation,
  });
  if (verifyResult.error) throw new Error('Wallet PIN check unavailable');
  return piggyvestGoalPinSchemas.verifyResult.parse(verifyResult.data);
}
