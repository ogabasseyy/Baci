import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { parseWalletActivityRows } from '@/lib/piggyvest/parse-wallet-activity-rows';
import { isPiggyvestFeatureFlagSet } from '@/lib/piggyvest/piggyvest-feature-on';
import { isPiggyvestKilled } from '@/lib/piggyvest/piggyvest-kill-switch';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import {
  readPrimaryWalletRuntime,
  readPrimaryWalletRuntimeDrain,
} from '@/lib/piggyvest/primary-wallet-runtime';
import { walletActivityCursor } from '@/lib/piggyvest/wallet-activity-cursor';
import { piggyvestWalletActivityQuerySchema } from '@/schemas/piggyvest-wallet-activity';

const fail = (error: string, code: string, status: number) =>
  NextResponse.json({ error, code }, { status });

/**
 * The signed-in customer's PiggyVest main-wallet activity, newest first.
 * Reads through public.list_piggyvest_wallet_activity on the customer's own
 * session client (no service role): the function itself keys every row on
 * auth.uid() and the store, and returns customer-facing fields only.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return fail('Please sign in again.', 'UNAUTHORIZED', 401);
  const params = new URL(request.url).searchParams;
  const parsed = piggyvestWalletActivityQuerySchema.safeParse(
    Object.fromEntries(params)
  );
  const cursor = parsed.success && parsed.data.cursor;
  const decoded = cursor ? walletActivityCursor.decode(cursor) : null;
  if (
    !parsed.success ||
    params.getAll('merchantId').length !== 1 ||
    (cursor && !decoded)
  )
    return fail('Invalid activity request.', 'INVALID_INPUT', 400);
  // Same store resolution as the wallet snapshot: the read-only view keeps
  // working under the kill switch through the drain reader.
  const runtime =
    readPrimaryWalletRuntime() ??
    (isPiggyvestKilled() && isPiggyvestFeatureFlagSet('wallet')
      ? readPrimaryWalletRuntimeDrain()
      : null);
  if (!runtime || runtime.onboarding.merchantId !== parsed.data.merchantId)
    return fail(
      'Wallet activity is temporarily unavailable.',
      'PIGGYVEST_NOT_READY',
      503
    );
  try {
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.onboarding.merchantId,
      forOnboarding: false,
    });
    if (!identity)
      return fail(
        'Please verify your email and complete your profile.',
        'PROFILE_VERIFICATION_REQUIRED',
        409
      );
    const { data, error } = await auth.supabase.rpc(
      'list_piggyvest_wallet_activity',
      {
        p_merchant_id: identity.merchantId,
        p_before_at: decoded ? decoded.beforeAt : null,
        p_before_id: decoded ? decoded.beforeId : null,
        p_limit: parsed.data.limit,
      }
    );
    if (error) throw error;
    const { rows, last, count } = parseWalletActivityRows(data);
    return NextResponse.json(
      {
        items: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          direction: row.direction,
          amountKobo: row.amount_kobo,
          feeKobo: row.fee_kobo,
          label: row.label,
          status: row.status,
          occurredAt: row.occurred_at,
        })),
        nextCursor:
          last && count === parsed.data.limit
            ? walletActivityCursor.encode(last)
            : null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return fail(
      'We couldn’t load your wallet activity.',
      'ACTIVITY_UNAVAILABLE',
      500
    );
  }
}
