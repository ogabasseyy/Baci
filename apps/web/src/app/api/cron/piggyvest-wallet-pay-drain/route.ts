import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { WALLET_PAY_DELIVERERS } from '@/lib/piggyvest/wallet-pay-deliverers';
import { runWalletPayDrain } from '@/lib/piggyvest/wallet-pay-drain';
import { readWalletPayRecoveryRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { isWalletPayWorkPending } from '@/lib/piggyvest/wallet-pay-work-pending';

export const maxDuration = 300;

// PiggyVest wallet pay background job: settles, releases, refunds and hands
// uncollected confirmed payments to their product. It runs under the recovery
// runtime (ignores the wallet pay flag and kill switch) so money is never
// stranded; with no wallet pay configuration it is unavailable (503). The
// response carries counts only, never ids or amounts.
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Scheduled before switch-on: with no collection wallet configured and no
  // wallet pay work waiting, wallet pay was never used and the drain idles.
  // Work waiting without the collection wallet (configuration removed, e.g.
  // in a rollback) pages instead, so money is never silently stranded.
  if (!process.env.PIGGYVEST_COLLECTION_WALLET_ID) {
    let pending: boolean;
    try {
      pending = await isWalletPayWorkPending();
    } catch {
      pending = true;
    }
    return pending
      ? NextResponse.json(
          { error: 'Wallet pay work is waiting but not configured' },
          { status: 503 }
        )
      : NextResponse.json({ status: 'not_configured' });
  }
  let runtime: ReturnType<typeof readWalletPayRecoveryRuntime>;
  try {
    runtime = readWalletPayRecoveryRuntime();
  } catch {
    return NextResponse.json(
      { error: 'Wallet pay is not configured' },
      { status: 503 }
    );
  }
  try {
    return NextResponse.json(
      await runWalletPayDrain({ runtime, deliverers: WALLET_PAY_DELIVERERS })
    );
  } catch {
    return NextResponse.json(
      { error: 'Wallet pay drain failed' },
      { status: 500 }
    );
  }
}
