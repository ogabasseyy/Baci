import 'server-only';
import { NextResponse } from 'next/server';
import { checkTenantRateLimit } from '@/lib/tenant-rate-limit';

// Per signed-in customer budgets for the wallet-PIN routes, charged AFTER
// authentication on top of the proxy's per-IP bucket. Carrier NAT puts many
// customers behind one IP, so the IP bucket alone can lock out legitimate
// customers and does not throttle one attacker rotating addresses.
const WINDOW_MS = 600_000;
const BUDGETS = {
  // Set and reset: one scrypt derivation each.
  mutation: { maxRequests: 5, windowMs: WINDOW_MS },
  // Change runs two scrypt derivations, so it gets a tighter, separate budget.
  change: { maxRequests: 3, windowMs: WINDOW_MS },
  // Goal-PIN verification, separate from the PIN mutations above.
  'goal-verify': { maxRequests: 5, windowMs: WINDOW_MS },
} as const;

export type WalletPinCustomerBudget = keyof typeof BUDGETS;

function limited(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      error: 'Too many attempts. Please try again later.',
      code: 'RATE_LIMITED',
    },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfterSeconds),
      },
    }
  );
}

// userId is the authenticated customer auth user id, not customers.id.
// Returns null when the call may proceed, otherwise the refusal to send.
// Redis unavailable or erroring denies closed, like the proxy PIN buckets.
export async function chargeWalletPinCustomerLimit(
  budget: WalletPinCustomerBudget,
  merchantId: string,
  userId: string
): Promise<NextResponse | null> {
  const config = BUDGETS[budget];
  try {
    const verdict = await checkTenantRateLimit(
      `wallet-pin:${budget}`,
      `${merchantId}:${userId}`,
      config
    );
    if (verdict === 'allowed') return null;
    // A sliding window frees capacity gradually and the verdict carries no
    // reset time, so the full window is a conservative upper bound.
    return limited(verdict === 'denied' ? config.windowMs / 1000 : 60);
  } catch {
    return limited(60);
  }
}
