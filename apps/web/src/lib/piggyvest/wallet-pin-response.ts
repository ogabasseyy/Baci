import { NextResponse } from 'next/server';
import type { GoalPinVerification } from '@/lib/piggyvest/goal-pin-verify';

const NO_STORE = { 'Cache-Control': 'no-store' };

function refuse(error: string, code: string, status: number, extra = {}) {
  return NextResponse.json(
    { error, code, ...extra },
    { status, headers: NO_STORE }
  );
}

/** The HTTP answer for one wallet PIN check (same codes as goal PIN checks). */
export function walletPinVerificationResponse(result: GoalPinVerification) {
  switch (result.status) {
    case 'verified':
      return NextResponse.json(
        { proof: result.proof, expiresAt: result.expiresAt },
        { headers: NO_STORE }
      );
    case 'incorrect':
      return refuse('That PIN is not right.', 'PIN_INCORRECT', 401, {
        attemptsRemaining: result.attemptsRemaining,
      });
    case 'locked':
      return refuse(
        'Too many wrong PINs. Please try again later.',
        'PIN_LOCKED',
        423,
        { lockedUntil: result.lockedUntil }
      );
    case 'not_set':
      return refuse('Please set your PIN first.', 'PIN_NOT_SET', 409);
    case 'reset_required':
      return refuse('Please reset your PIN.', 'PIN_RESET_REQUIRED', 409);
    case 'too_many_proofs':
      return refuse('Please wait a moment and try again.', 'PIN_BUSY', 429);
    default:
      return refuse(
        'PIN checks are temporarily unavailable.',
        'PIN_UNAVAILABLE',
        503
      );
  }
}
