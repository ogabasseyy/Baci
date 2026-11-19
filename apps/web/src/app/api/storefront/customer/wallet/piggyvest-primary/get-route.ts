import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { isPiggyvestFeatureFlagSet } from '@/lib/piggyvest/piggyvest-feature-on';
import { isPiggyvestKilled } from '@/lib/piggyvest/piggyvest-kill-switch';
import { createPrimaryWalletExecutor } from '@/lib/piggyvest/primary-wallet-executor';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readPrimaryWalletMapping } from '@/lib/piggyvest/primary-wallet-mapping';
import { hasPrimaryWalletOnboarding } from '@/lib/piggyvest/primary-wallet-presence';
import { getPrimaryWalletProviderOrigin } from '@/lib/piggyvest/primary-wallet-provider-origin';
import { readPrimaryWalletReview } from '@/lib/piggyvest/primary-wallet-review';
import { recoverPrimaryWalletRouting } from '@/lib/piggyvest/primary-wallet-routing-recovery';
import {
  readPrimaryWalletRuntime,
  readPrimaryWalletRuntimeDrain,
} from '@/lib/piggyvest/primary-wallet-runtime';
import { readPrimaryWalletSnapshot } from '@/lib/piggyvest/primary-wallet-snapshot';
import {
  notStartedPrimaryWalletSnapshot,
  PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER,
} from '@/lib/piggyvest/primary-wallet-snapshot-contract';
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
    // Under the master kill switch the read-only view keeps working through
    // the drain reader, so customers can still see their balance and goals.
    // Routing recovery (which can promote a wallet) is new work and is skipped.
    const killed = isPiggyvestKilled();
    const runtime =
      readPrimaryWalletRuntime() ??
      (killed && isPiggyvestFeatureFlagSet('wallet')
        ? readPrimaryWalletRuntimeDrain()
        : null);
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
    // A customer with no durable onboarding intent has nothing to read at
    // the provider or in review storage: answer before either is touched.
    // A failed or malformed presence read throws and fails closed below.
    // Only a client that advertises the not_started status receives it;
    // installed builds keep the pending reply their strict schema accepts.
    if (!(await hasPrimaryWalletOnboarding(scope, execute))) {
      return NextResponse.json(
        notStartedPrimaryWalletSnapshot(request.headers),
        {
          headers: {
            'Cache-Control': 'no-store',
            Vary: PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER,
          },
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
      // Recovery can promote a wallet, so it is new work: skipped when killed.
      const recovery = killed
        ? ('unavailable' as const)
        : await recoverPrimaryWalletRouting({
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
    return NextResponse.json(snapshot, {
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
