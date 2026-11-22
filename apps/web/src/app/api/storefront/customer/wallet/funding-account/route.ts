import type { SupabaseClient, User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  ensureCustomerWalletPaymentAccount,
  resolveCustomerWalletPaymentAccount,
} from '@/lib/customer-wallet-payment-accounts';
import { fetchMerchantPaystackSubaccountCode } from '@/lib/fetch-merchant-payment-secret';
import { resolveWalletTopUpMerchant } from '@/lib/resolve-wallet-top-up-merchant';
import { resolveVtuCustomer } from '@/lib/vtu-pending-transaction';
import { createWalletDvaAccountWriter } from '@/lib/wallet-dva-provisioner';
import {
  walletFundingAccountConsentSchema,
  walletFundingAccountQuerySchema,
} from '@/schemas/wallet-funding-account';
import { walletAccountErrorResponse } from './wallet-funding-account-error';

// Identity only (no secret) — resolved on the caller's RLS client so an
// unpublished merchant is indistinguishable from a nonexistent one (no oracle).
const MERCHANT_IDENTITY_SELECT = 'id, slug, business_name';

interface FundingAccountMerchantIdentity {
  business_name: string | null;
  id: string;
  slug: string | null;
}

interface FundingAccountMerchant {
  business_name: string | null;
  id: string;
  paystack_subaccount_code: string | null;
  slug: string | null;
}

type FundingAccountResolvedContext =
  | {
      response: NextResponse;
    }
  | {
      customer: NonNullable<Awaited<ReturnType<typeof resolveVtuCustomer>>>;
      merchant: FundingAccountMerchant;
      supabase: SupabaseClient;
    };

function formatFundingAccount(account: CustomerWalletPaymentAccount | null) {
  if (!account) {
    return null;
  }

  return {
    accountName: account.accountName,
    accountNumber: account.accountNumber,
    bankName: account.bankName,
    provider: account.provider,
  };
}

function getIdentifierParams(searchParams: URLSearchParams) {
  return {
    merchantId: searchParams.get('merchantId') ?? undefined,
    merchantSlug: searchParams.get('merchantSlug') ?? undefined,
  };
}

async function resolveMerchantAndCustomer({
  identifiers,
  supabase,
  user,
}: {
  identifiers: { merchantId?: string; merchantSlug?: string };
  supabase: SupabaseClient;
  user: User;
}): Promise<FundingAccountResolvedContext> {
  // Resolve identity on the caller's RLS client first — no cross-tenant oracle.
  const identity =
    await resolveWalletTopUpMerchant<FundingAccountMerchantIdentity>(
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

  // Customer is verified — only now read the revoked payment secret, via the
  // bounded SECURITY DEFINER RPC on the caller's authenticated client.
  const merchant: FundingAccountMerchant = {
    ...identity,
    paystack_subaccount_code: await fetchMerchantPaystackSubaccountCode(
      supabase,
      identity.id
    ),
  };

  return { customer, merchant, supabase };
}

async function isWalletDvaEnabled({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase.rpc(
    'get_customer_wallet_dva_enabled',
    {
      p_customer_id: customerId,
      p_merchant_id: merchantId,
    }
  );

  if (error) {
    console.error('Customer wallet DVA flag lookup failed', {
      customerId,
      error,
      merchantId,
    });
    throw error;
  }

  return data === true;
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

    const parsed = walletFundingAccountQuerySchema.safeParse(
      getIdentifierParams(new URL(request.url).searchParams)
    );
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

    const account = await resolveCustomerWalletPaymentAccount({
      customerId: resolved.customer.id,
      merchantId: resolved.merchant.id,
      supabase: resolved.supabase,
    });

    return NextResponse.json({
      account: formatFundingAccount(account),
      requiresConsent: !account,
    });
  } catch (error) {
    console.error('Failed to fetch wallet funding account', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet funding account' },
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
    const parsed = walletFundingAccountConsentSchema.safeParse(body);
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

    const enabled = await isWalletDvaEnabled({
      customerId: resolved.customer.id,
      merchantId: resolved.merchant.id,
      supabase: resolved.supabase,
    });
    if (!enabled) {
      return NextResponse.json(
        {
          error: 'Wallet bank transfer funding is not enabled',
          code: 'WALLET_DVA_DISABLED',
        },
        { status: 403 }
      );
    }

    // Provider data is persisted through the separately provisioned, exact
    // wallet-DVA writer. The request and all identity resolution remain under
    // the caller's RLS client; this route never constructs service_role.
    const walletDvaWriter = createWalletDvaAccountWriter();
    const account = await ensureCustomerWalletPaymentAccount({
      consentedAt: new Date(),
      customer: resolved.customer,
      merchant: resolved.merchant,
      supabase: resolved.supabase,
      userId: auth.user.id,
      walletDvaWriter,
    });

    return NextResponse.json({
      account: formatFundingAccount(account),
      requiresConsent: false,
    });
  } catch (error) {
    if (error instanceof CustomerWalletPaymentAccountError) {
      return walletAccountErrorResponse(error);
    }

    console.error('Failed to create wallet funding account', error);
    return NextResponse.json(
      { error: 'Failed to create wallet funding account' },
      { status: 500 }
    );
  }
}
