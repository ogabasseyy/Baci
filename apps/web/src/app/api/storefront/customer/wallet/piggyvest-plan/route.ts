import type { SupabaseClient, User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { getPiggyvestApiConfig } from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getPlanWalletSnapshot,
  PlanWalletError,
} from '@/lib/piggyvest/plan-wallets';
import { stagingPlanWalletConfig } from '@/lib/piggyvest/staging-plan-wallet-config';
import { resolveWalletTopUpMerchant } from '@/lib/resolve-wallet-top-up-merchant';
import { resolveVtuCustomer } from '@/lib/vtu-pending-transaction';
import {
  type PiggyvestPlanIdentifiers,
  piggyvestPlanIdentifiersSchema,
} from '@/schemas/piggyvest-plan';

// Identity only (no secret) — resolved on the caller's RLS client so an
// unpublished merchant is indistinguishable from a nonexistent one (no oracle).
const MERCHANT_IDENTITY_SELECT = 'id, slug, business_name';

interface PlanWalletMerchantIdentity {
  business_name: string | null;
  id: string;
  slug: string | null;
}

type PlanWalletResolvedContext =
  | { response: NextResponse }
  | {
      customer: NonNullable<Awaited<ReturnType<typeof resolveVtuCustomer>>>;
      merchantId: string;
    };

async function resolveMerchantAndCustomer({
  identifiers,
  supabase,
  user,
}: {
  identifiers: PiggyvestPlanIdentifiers;
  supabase: SupabaseClient;
  user: User;
}): Promise<PlanWalletResolvedContext> {
  const identity = await resolveWalletTopUpMerchant<PlanWalletMerchantIdentity>(
    supabase,
    identifiers,
    MERCHANT_IDENTITY_SELECT
  );
  if (!identity) {
    return {
      response: NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      ),
    };
  }

  const customer = await resolveVtuCustomer({
    merchantId: identity.id,
    supabase,
    user,
  });
  if (!customer) {
    return {
      response: NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      ),
    };
  }

  return { customer, merchantId: identity.id };
}

function planWalletErrorResponse(error: PlanWalletError): NextResponse {
  switch (error.code) {
    case 'PLAN_WALLET_NOT_CONFIGURED':
      return NextResponse.json(
        { error: 'Integration unavailable', code: 'PIGGYVEST_NOT_READY' },
        { status: 503 }
      );
    case 'PLAN_WALLET_KYC_UNAVAILABLE':
      return NextResponse.json(
        {
          error: 'Wallet provisioning is unavailable',
          code: 'PLAN_WALLET_KYC_DISABLED',
        },
        { status: 503 }
      );
    case 'PLAN_WALLET_PROVIDER_ERROR':
      return NextResponse.json(
        {
          error: 'Wallet provider unavailable',
          code: 'PIGGYVEST_PROVIDER_ERROR',
        },
        { status: 502 }
      );
    case 'PLAN_WALLET_STORAGE_ERROR':
      return NextResponse.json(
        { error: 'Failed to load plan wallet' },
        { status: 500 }
      );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const params = new URL(request.url).searchParams;
    const parsed = piggyvestPlanIdentifiersSchema.safeParse({
      merchantId: params.get('merchantId') ?? undefined,
      merchantSlug: params.get('merchantSlug') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const resolved = await resolveMerchantAndCustomer({
      identifiers: parsed.data,
      supabase: auth.supabase,
      user: auth.user,
    });
    if ('response' in resolved) {
      return resolved.response;
    }

    const config = stagingPlanWalletConfig(
      getPiggyvestApiConfig(),
      process.env.VERCEL_ENV
    );
    if (!config) {
      return planWalletErrorResponse(
        new PlanWalletError(
          'PLAN_WALLET_NOT_CONFIGURED',
          'Integration unavailable'
        )
      );
    }

    const snapshot = await getPlanWalletSnapshot(auth.supabase, config, {
      customerId: resolved.customer.id,
      merchantId: resolved.merchantId,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof PlanWalletError) {
      return planWalletErrorResponse(error);
    }
    console.error('Failed to fetch plan wallet');
    return NextResponse.json(
      { error: 'Failed to fetch plan wallet' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON', code: 'MALFORMED_JSON' },
        { status: 400 }
      );
    }
    const parsed = piggyvestPlanIdentifiersSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const resolved = await resolveMerchantAndCustomer({
      identifiers: parsed.data,
      supabase: auth.supabase,
      user: auth.user,
    });
    if ('response' in resolved) {
      return resolved.response;
    }

    return NextResponse.json(
      {
        error: 'Wallet provisioning is unavailable',
        code: 'PLAN_WALLET_PROVISIONING_UNAVAILABLE',
      },
      { status: 503 }
    );
  } catch (error) {
    if (error instanceof PlanWalletError) {
      return planWalletErrorResponse(error);
    }
    console.error('Failed to create plan wallet');
    return NextResponse.json(
      { error: 'Failed to create plan wallet' },
      { status: 500 }
    );
  }
}
