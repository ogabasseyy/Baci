import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createPrimaryWalletExecutor } from '@/lib/piggyvest/primary-wallet-executor';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readPrimaryWalletMapping } from '@/lib/piggyvest/primary-wallet-mapping';
import { onboardPiggyvestPrimaryWallet } from '@/lib/piggyvest/primary-wallet-onboarding';
import { createPrimaryWalletProviderCustomer } from '@/lib/piggyvest/primary-wallet-provider';
import { getPrimaryWalletProviderOrigin } from '@/lib/piggyvest/primary-wallet-provider-origin';
import { readPrimaryWalletRuntime } from '@/lib/piggyvest/primary-wallet-runtime';
import { readPrimaryWalletSnapshot } from '@/lib/piggyvest/primary-wallet-snapshot';
import { createPrimaryWalletStore } from '@/lib/piggyvest/primary-wallet-store';
import { verifyPrimaryWalletMapping } from '@/lib/piggyvest/primary-wallet-verification';
import { retrievePiggyvestFundingAccounts } from '@/lib/piggyvest/wallet-funding';
import { retrievePiggyvestWallet } from '@/lib/piggyvest/wallets';
import {
  piggyvestPrimaryWalletQuerySchema,
  piggyvestPrimaryWalletRequestSchema,
} from '@/schemas/piggyvest-primary-wallet-request';

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
    const providerConfig = {
      token: runtime.providerToken,
      baseUrl: getPrimaryWalletProviderOrigin(runtime.onboarding.environment),
    };
    const snapshot = await readPrimaryWalletSnapshot({
      businessId: runtime.onboarding.businessId,
      loadMapping: () => readPrimaryWalletMapping(scope, execute),
      retrieveWallet: (walletId) =>
        retrievePiggyvestWallet(providerConfig, walletId),
      retrieveAccounts: (walletId) =>
        retrievePiggyvestFundingAccounts(providerConfig, walletId),
      verifyMapping: (proof) =>
        verifyPrimaryWalletMapping({ scope, proof, execute }),
    });
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: 'Please sign in again.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json(
        { error: 'Please refresh and try again.', code: 'CSRF_INVALID' },
        { status: 403 }
      )
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }
  const parsed = piggyvestPrimaryWalletRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Enter a valid 11-digit BVN and accept wallet setup.',
        code: 'INVALID_INPUT',
      },
      { status: 400 }
    );
  }
  try {
    const runtime = readPrimaryWalletRuntime();
    if (!runtime || runtime.onboarding.merchantId !== parsed.data.merchantId) {
      return NextResponse.json(
        {
          error: 'Wallet setup is temporarily unavailable.',
          code: 'PIGGYVEST_NOT_READY',
        },
        { status: 503 }
      );
    }
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.onboarding.merchantId,
    });
    if (!identity) {
      return NextResponse.json(
        {
          error:
            'Verify your email and complete your account profile before setting up your wallet.',
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
    const outcome = await onboardPiggyvestPrimaryWallet({
      configuration: runtime.onboarding,
      verifiedIdentity: identity,
      request: { bvn: parsed.data.bvn, consent: parsed.data.consent },
      storage: createPrimaryWalletStore({
        scope,
        execute: createPrimaryWalletExecutor(runtime),
      }),
      createCustomer: (command) =>
        createPrimaryWalletProviderCustomer(
          {
            token: runtime.providerToken,
            baseUrl: getPrimaryWalletProviderOrigin(
              runtime.onboarding.environment
            ),
          },
          command
        ),
    });
    if (outcome.status === 'unavailable') {
      return NextResponse.json(
        {
          error:
            'Wallet setup could not be confirmed. Please try refreshing later.',
          code: outcome.code,
        },
        { status: 503 }
      );
    }
    if (outcome.status === 'conflict') {
      return NextResponse.json(
        {
          error:
            'Your wallet identity needs verification. Please contact support; no duplicate wallet will be created.',
          code: 'OWNERSHIP_REVIEW_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { status: outcome.status },
      {
        status: outcome.status === 'ready' ? 200 : 202,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          'Wallet setup is temporarily unavailable. Please try again later.',
        code: 'PIGGYVEST_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
}
