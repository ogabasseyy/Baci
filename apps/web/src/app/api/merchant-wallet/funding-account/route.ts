import type { SupabaseClient, User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
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

async function ownerContext(request: NextRequest) {
  const context = await authContext(request);
  if ('response' in context) return context;
  return ownerContextAfterAuth(context);
}

export async function GET(request: NextRequest) {
  const context = await ownerContext(request);
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
  const context = await ownerContextAfterAuth(auth);
  if ('response' in context) return context.response;
  try {
    const result = await requestMerchantWalletAccount(context.supabase, {
      id: context.merchant.id,
      email: context.merchant.email ?? context.user.email ?? '',
      firstName: context.merchant.business_name,
    });
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
        const result = await requestMerchantWalletAccount(context.supabase, {
          id: context.merchant.id,
          email: context.merchant.email ?? context.user.email ?? '',
          firstName: context.merchant.business_name,
        });
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

async function ownerContextAfterAuth(auth: AuthContext) {
  const { data: merchant, error } = await auth.supabase
    .from('merchants')
    .select('id, business_name, email')
    .eq('user_id', auth.user.id)
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
  return { ...auth, merchant } as const;
}
