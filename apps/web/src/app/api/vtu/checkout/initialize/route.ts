import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';

function createErrorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user) {
      return createErrorResponse(auth.error || 'Unauthorized', 401);
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return csrfResponse ?? createErrorResponse('CSRF validation failed', 403);
    }

    // Wallet-only VTU checkout: gateway (card) payments for utilities are
    // disabled because gateway fees erase the margin. Customers fund their
    // wallet — bearing the funding charges — and pay from wallet balance
    // via /api/vtu/checkout/wallet-only. This route stays mounted so stale
    // clients get an actionable error instead of a 404. The rejection runs
    // before body parsing on purpose: a stale client whose payload no
    // longer matches the schema must still get the VTU_WALLET_ONLY code,
    // not a generic validation error.
    return NextResponse.json(
      {
        error:
          'Utilities now go through your wallet. Fund your wallet, then pay from your wallet balance.',
        code: 'VTU_WALLET_ONLY',
      },
      { status: 400 }
    );
  } catch (error) {
    // Don't echo raw error messages: the only throw sources are the
    // auth/CSRF guards, and their messages can leak Supabase URL/schema
    // fragments. Log server-side and return a generic 500 (a guard throw
    // is an infrastructure failure, not a VTU_WALLET_ONLY routing case).
    console.error('Gateway initialize stub failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return createErrorResponse('Failed to initialize payment.', 500);
  }
}
