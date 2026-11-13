import 'server-only';
import { NextResponse } from 'next/server';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';

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
  // Wallet pay PIN checks (VTU), so a purchase never spends the goal budget.
  'wallet-pay-verify': { maxRequests: 5, windowMs: WINDOW_MS },
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

// Seconds until the limiter frees capacity, kept within 1 s and the window;
// the full window when the limiter gave no reset time.
function retryAfterSeconds(resetAt: number | undefined, windowMs: number) {
  const windowSeconds = windowMs / 1000;
  if (resetAt === undefined || !Number.isFinite(resetAt)) return windowSeconds;
  const seconds = Math.ceil((resetAt - Date.now()) / 1000);
  return Math.min(windowSeconds, Math.max(1, seconds));
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
    const { verdict, resetAt } = await checkTenantRateLimitDetailed(
      `wallet-pin:${budget}`,
      `${merchantId}:${userId}`,
      config
    );
    if (verdict === 'allowed') return null;
    if (verdict !== 'denied') return limited(60);
    return limited(retryAfterSeconds(resetAt, config.windowMs));
  } catch {
    return limited(60);
  }
}
