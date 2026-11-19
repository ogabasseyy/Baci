import 'server-only';
import { type WalletPinState, walletPinSchemas } from '@/schemas/wallet-pin';
import { signWalletPinAttestation } from './wallet-pin-attestation';
import {
  createWalletPinSalt,
  deriveWalletPinHash,
  getWalletPinPepperState,
  WALLET_PIN_KDF_VERSION,
  type WalletPinPepper,
} from './wallet-pin-kdf';

type RpcName =
  | 'get_wallet_pin_state'
  | 'has_recent_wallet_pin_sign_in'
  | 'set_wallet_pin'
  | 'change_wallet_pin'
  | 'reset_wallet_pin';

type Rpc = (
  name: RpcName,
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: unknown }>;

type Context = {
  readonly rpc: Rpc;
  readonly userId: string;
  readonly merchantId: string;
  readonly now: () => number;
};

export type WalletPinRefusal =
  | { status: 'incorrect'; attemptsRemaining: number }
  | { status: 'locked'; lockedUntil: string }
  | {
      status:
        | 'unavailable'
        | 'not_set'
        | 'reset_required'
        | 'already_set'
        | 'reauthentication_required';
    };

export type WalletPinOutcome = { status: 'ok' } | WalletPinRefusal;

export type WalletPinStatus = {
  hasPin: boolean;
  resetRequired: boolean;
  available: boolean;
  // True when setting or resetting a PIN now would be refused for an old
  // sign-in, so the app can ask the customer to confirm it's them first.
  signInConfirmationRequired: boolean;
};

// The server derives every hash and signs every request; the database
// enforces lockout, binding and sign-in age. Nothing here logs, returns or
// embeds a PIN or the pepper, and any unexpected database answer throws
// instead of passing.

function readyPepper(): WalletPinPepper | null {
  const state = getWalletPinPepperState();
  return state.status === 'ready' ? state.pepper : null;
}

async function call(rpc: Rpc, name: RpcName, args: Record<string, unknown>) {
  const result = await rpc(name, args);
  if (result.error) throw new Error(`Wallet PIN ${name} unavailable`);
  return result.data;
}

function readState(rpc: Rpc, merchantId: string, pepper: WalletPinPepper) {
  return call(rpc, 'get_wallet_pin_state', {
    p_merchant_id: merchantId,
    p_pepper_id: pepper.id,
  }).then((data) => walletPinSchemas.pinState.parse(data));
}

export async function readWalletPinStatus(input: {
  rpc: Rpc;
  merchantId: string;
}): Promise<WalletPinStatus> {
  const pepper = readyPepper();
  if (!pepper)
    return {
      hasPin: false,
      resetRequired: false,
      available: false,
      signInConfirmationRequired: false,
    };
  const state = await readState(input.rpc, input.merchantId, pepper);
  const available = state.status !== 'unavailable';
  return {
    hasPin: state.status !== 'not_set' && available,
    resetRequired: state.status === 'reset_required',
    available,
    signInConfirmationRequired:
      available && !(await readRecentSignIn(input.rpc)),
  };
}

// The same answer set and reset will enforce (has_recent_authentication), read
// ahead of time. Only a hint: when the read itself fails it reports "recent",
// which is the old behaviour, and a save that is then refused still sends the
// customer to the confirm step.
async function readRecentSignIn(rpc: Rpc): Promise<boolean> {
  try {
    const result = await rpc('has_recent_wallet_pin_sign_in', {});
    if (result.error) return true;
    return walletPinSchemas.recentSignIn.parse(result.data);
  } catch {
    return true;
  }
}

export async function setWalletPin(
  input: Context & { pin: string }
): Promise<WalletPinOutcome> {
  const pepper = readyPepper();
  if (!pepper) return { status: 'unavailable' };
  const salt = createWalletPinSalt();
  const pinHash = await deriveWalletPinHash({ pin: input.pin, salt, pepper });
  // Stamped after the slow derivation so the two-minute window is spent on
  // the request, not on hashing.
  const attestation = signWalletPinAttestation({
    pepper,
    userId: input.userId,
    merchantId: input.merchantId,
    attestedAtMs: input.now(),
    request: { operation: 'set', salt, pinHash },
  });
  const data = await call(input.rpc, 'set_wallet_pin', {
    p_merchant_id: input.merchantId,
    p_pepper_id: pepper.id,
    p_kdf_version: WALLET_PIN_KDF_VERSION,
    p_salt: salt,
    p_pin_hash: pinHash,
    p_attestation: attestation,
  });
  const result = walletPinSchemas.setResult.parse(data);
  if (result.status === 'set') return { status: 'ok' };
  return { status: result.status };
}

export async function resetWalletPin(
  input: Context & { pin: string }
): Promise<WalletPinOutcome> {
  const pepper = readyPepper();
  if (!pepper) return { status: 'unavailable' };
  const salt = createWalletPinSalt();
  const pinHash = await deriveWalletPinHash({ pin: input.pin, salt, pepper });
  const attestation = signWalletPinAttestation({
    pepper,
    userId: input.userId,
    merchantId: input.merchantId,
    attestedAtMs: input.now(),
    request: { operation: 'reset', salt, pinHash },
  });
  const data = await call(input.rpc, 'reset_wallet_pin', {
    p_merchant_id: input.merchantId,
    p_pepper_id: pepper.id,
    p_kdf_version: WALLET_PIN_KDF_VERSION,
    p_salt: salt,
    p_pin_hash: pinHash,
    p_attestation: attestation,
  });
  const result = walletPinSchemas.resetResult.parse(data);
  if (result.status === 'reset') return { status: 'ok' };
  return { status: result.status };
}

function refusalFromState(state: Exclude<WalletPinState, { status: 'set' }>) {
  return state;
}

export async function changeWalletPin(
  input: Context & { currentPin: string; newPin: string }
): Promise<WalletPinOutcome> {
  const pepper = readyPepper();
  if (!pepper) return { status: 'unavailable' };
  const state = await readState(input.rpc, input.merchantId, pepper);
  if (state.status !== 'set') return refusalFromState(state);
  const currentPinHash = await deriveWalletPinHash({
    pin: input.currentPin,
    salt: state.salt,
    pepper,
  });
  const salt = createWalletPinSalt();
  const pinHash = await deriveWalletPinHash({
    pin: input.newPin,
    salt,
    pepper,
  });
  const attestation = signWalletPinAttestation({
    pepper,
    userId: input.userId,
    merchantId: input.merchantId,
    attestedAtMs: input.now(),
    request: { operation: 'change', currentPinHash, salt, pinHash },
  });
  const data = await call(input.rpc, 'change_wallet_pin', {
    p_merchant_id: input.merchantId,
    p_pepper_id: pepper.id,
    p_current_pin_hash: currentPinHash,
    p_kdf_version: WALLET_PIN_KDF_VERSION,
    p_salt: salt,
    p_pin_hash: pinHash,
    p_attestation: attestation,
  });
  const result = walletPinSchemas.changeResult.parse(data);
  return result.status === 'changed' ? { status: 'ok' } : result;
}
