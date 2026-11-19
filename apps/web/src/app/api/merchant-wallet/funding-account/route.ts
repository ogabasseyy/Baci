import type { SupabaseClient, User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantWalletAccount,
  requestMerchantWalletAccount,
} from '@/lib/merchant-wallet-payment-accounts';
import { merchantWalletFundingConsentSchema } from '@/schemas/merchant-wallet-funding';

type AuthContext = { supabase: SupabaseClient; user: User };
type ContextResponse = { response: NextResponse };

async function authContext(
  request: NextRequest,
  csrf = false
): Promise<AuthContext | ContextResponse> {
  const auth = await authenticateApiRequest(request);
  if (!auth.user || !auth.supabase)
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as const;
  if (csrf) {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return {
        response:
          csrf.response ??
          NextResponse.json(
            { error: 'CSRF validation failed' },
            { status: 403 }
          ),
      } as const;
    }
  }
  return { supabase: auth.supabase, user: auth.user } as const;
}

async function merchantContext(request: NextRequest) {
  const context = await authContext(request);
  if ('response' in context) return context;
  return merchantContextAfterAuth(context);
}

export async function GET(request: NextRequest) {
  const context = await merchantContext(request);
  if ('response' in context) return context.response;
  try {
    return NextResponse.json({
      account: await getMerchantWalletAccount(
        context.supabase,
        context.merchant.id
      ),
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load funding account' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authContext(request, true);
  if ('response' in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = merchantWalletFundingConsentSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: 'Consent is required' }, { status: 400 });
  const context = await merchantContextAfterAuth(auth);
  if ('response' in context) return context.response;
  // The virtual account is opened in the business identity. Only the owner's
  // login email may stand in for a missing merchant email: a staff email would
  // register the merchant's account under that staff member's provider
  // customer, and the stuck-request resume lookup would never find it.
  const email =
    context.merchant.email?.trim() ||
    (context.isOwner ? context.user.email?.trim() : '') ||
    '';
  if (!email)
    return NextResponse.json(
      {
        error: 'Add a business email before opening a funding account.',
        code: 'MERCHANT_EMAIL_REQUIRED',
      },
      { status: 409 }
    );
  const identity = {
    id: context.merchant.id,
    email,
    firstName: context.merchant.business_name,
  };
  try {
    const result = await requestMerchantWalletAccount(
      context.supabase,
      identity
    );
    return NextResponse.json(
      { account: result.account, status: result.status },
      { status: result.status === 'pending' ? 202 : 200 }
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === 'FUNDING_REQUEST_EXPIRED_RETRY'
    ) {
      try {
        const result = await requestMerchantWalletAccount(
          context.supabase,
          identity
        );
        return NextResponse.json(
          { account: result.account, status: result.status },
          { status: result.status === 'pending' ? 202 : 200 }
        );
      } catch {
        return NextResponse.json(
          { error: 'Unable to start funding account assignment' },
          { status: 502 }
        );
      }
    }
    return NextResponse.json(
      { error: 'Unable to start funding account assignment' },
      { status: 502 }
    );
  }
}

// The owner and staff granted orders.fulfill may view and open the merchant's
// wallet funding account. The merchant comes from the caller's access record,
// never from the request.
async function merchantContextAfterAuth(auth: AuthContext) {
  const access = await getUserAccess(auth.supabase);
  if (!access?.merchantId || !hasPermission(access, 'orders', 'fulfill'))
    return {
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as const;
  const { data: merchant, error } = await auth.supabase
    .from('merchants')
    .select('id, business_name, email')
    .eq('id', access.merchantId)
    .maybeSingle();
  if (error)
    return {
      response: NextResponse.json(
        { error: 'Unable to load merchant' },
        { status: 500 }
      ),
    } as const;
  if (!merchant)
    return {
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as const;
  return { ...auth, merchant, isOwner: access.isOwner } as const;
}
