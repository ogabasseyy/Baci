import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { createPrimaryWalletExecutor } from '@/lib/piggyvest/primary-wallet-executor';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readPrimaryWalletMapping } from '@/lib/piggyvest/primary-wallet-mapping';
import { hasPrimaryWalletOnboarding } from '@/lib/piggyvest/primary-wallet-presence';
import { getPrimaryWalletProviderOrigin } from '@/lib/piggyvest/primary-wallet-provider-origin';
import { canRecoverPrimaryWalletOnboarding } from '@/lib/piggyvest/primary-wallet-recovery-availability';
import { readPrimaryWalletReview } from '@/lib/piggyvest/primary-wallet-review';
import { recoverPrimaryWalletRouting } from '@/lib/piggyvest/primary-wallet-routing-recovery';
import { readPrimaryWalletRuntime } from '@/lib/piggyvest/primary-wallet-runtime';
import { readPrimaryWalletSnapshot } from '@/lib/piggyvest/primary-wallet-snapshot';
import { verifyPrimaryWalletMapping } from '@/lib/piggyvest/primary-wallet-verification';
import { retrievePiggyvestFundingAccounts } from '@/lib/piggyvest/wallet-funding';
import { retrievePiggyvestWallet } from '@/lib/piggyvest/wallets';
import { piggyvestPrimaryWalletQuerySchema } from '@/schemas/piggyvest-primary-wallet-request';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: 'Please sign in again.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }
  const params = new URL(request.url).searchParams;
  const parsed = piggyvestPrimaryWalletQuerySchema.safeParse(
    Object.fromEntries(params)
  );
  if (!parsed.success || params.getAll('merchantId').length !== 1) {
    return NextResponse.json(
      { error: 'Invalid wallet request.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }
  try {
    const runtime = readPrimaryWalletRuntime();
    if (!runtime || runtime.onboarding.merchantId !== parsed.data.merchantId) {
      return NextResponse.json(
        {
          error: 'Wallet access is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        },
        { status: 503 }
      );
    }
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.onboarding.merchantId,
      forOnboarding: false,
    });
    if (!identity) {
      return NextResponse.json(
        {
          error: 'Please verify your email and complete your profile.',
          code: 'PROFILE_VERIFICATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    const scope = {
      merchantId: identity.merchantId,
      customerId: identity.customerId,
      userId: identity.userId,
      integrationId: runtime.onboarding.integrationId,
      businessId: runtime.onboarding.businessId,
      environment: runtime.onboarding.environment,
    };
    const execute = createPrimaryWalletExecutor(runtime);
    if (!(await hasPrimaryWalletOnboarding(scope, execute))) {
      return NextResponse.json(
        { status: 'not_started', account: null },
        {
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }
    const providerConfig = {
      token: runtime.providerToken,
      baseUrl: getPrimaryWalletProviderOrigin(runtime.onboarding.environment),
    };
    const readSnapshot = () =>
      readPrimaryWalletSnapshot({
        businessId: runtime.onboarding.businessId,
        loadMapping: () => readPrimaryWalletMapping(scope, execute),
        retrieveWallet: (walletId) =>
          retrievePiggyvestWallet(providerConfig, walletId),
        retrieveAccounts: (walletId) =>
          retrievePiggyvestFundingAccounts(providerConfig, walletId),
        verifyMapping: (proof) =>
          verifyPrimaryWalletMapping({ scope, proof, execute }),
      });
    let snapshot = await readSnapshot();
    // A wallet created while its interest routing was not readable is kept
    // unusable; a pending refresh re-reads it (read-only, never re-creating,
    // and against the payout wallet stored at creation) so setup can finish
    // without a second BVN submission. Ready wallets never pay for this.
    if (snapshot.status === 'pending') {
      const review = await readPrimaryWalletReview({ scope, execute });
      if (review === 'routing') {
        return NextResponse.json(
          {
            error:
              'Your wallet interest routing needs review. Please contact support.',
            code: 'INTEREST_ROUTING_REVIEW_REQUIRED',
          },
          { status: 409, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (review === 'ownership') {
        return NextResponse.json(
          {
            error:
              'Your wallet identity needs verification. Please contact support; no duplicate wallet will be created.',
            code: 'OWNERSHIP_REVIEW_REQUIRED',
          },
          { status: 409, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      const recovery = await recoverPrimaryWalletRouting({
        scope,
        execute,
        retrieveWallet: (walletId) =>
          retrievePiggyvestWallet(providerConfig, walletId),
      }).catch(() => 'unavailable' as const);
      if (recovery === 'rejected') {
        // Recovery can reject for either an ownership contradiction or an
        // immutable routing contradiction. Re-read the persisted, scoped
        // classification before choosing the public response; if it cannot
        // be confirmed, the outer handler fails closed with 503.
        const rejectedReview = await readPrimaryWalletReview({
          scope,
          execute,
        });
        if (rejectedReview === 'ownership') {
          return NextResponse.json(
            {
              error:
                'Your wallet identity needs verification. Please contact support; no duplicate wallet will be created.',
              code: 'OWNERSHIP_REVIEW_REQUIRED',
            },
            { status: 409, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        if (rejectedReview !== 'routing') {
          throw new Error(
            'Rejected wallet recovery has no review classification'
          );
        }
        return NextResponse.json(
          {
            error:
              'Your wallet interest routing needs review. Please contact support.',
            code: 'INTEREST_ROUTING_REVIEW_REQUIRED',
          },
          { status: 409, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (recovery === 'promoted') snapshot = await readSnapshot();
    }
    if (snapshot.status === 'unavailable') {
      return NextResponse.json(
        {
          error: 'Could not confirm your wallet details. Please refresh later.',
          code: 'PIGGYVEST_UNAVAILABLE',
        },
        { status: 503 }
      );
    }
    const responseSnapshot =
      snapshot.status === 'pending'
        ? {
            ...snapshot,
            recoverable: await canRecoverPrimaryWalletOnboarding(
              scope,
              execute
            ),
          }
        : snapshot;
    return NextResponse.json(responseSnapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      {
        error: 'Wallet access is temporarily unavailable.',
        code: 'PIGGYVEST_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
}
