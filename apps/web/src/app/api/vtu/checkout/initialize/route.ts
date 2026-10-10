import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { vtuCheckoutInitializeSchema } from '@/schemas/vtu';

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

    const body = await request.json();
    const parsed = vtuCheckoutInitializeSchema.safeParse({
      ...body,
      source: 'checkout',
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Wallet-only VTU checkout: gateway (card) payments for utilities are
    // disabled because gateway fees erase the margin. Customers fund their
    // wallet — bearing the funding charges — and pay from wallet balance
    // via /api/vtu/checkout/wallet-only. This route stays mounted so stale
    // clients get an actionable error instead of a 404.
    return NextResponse.json(
      {
        error:
          'Utilities now go through your wallet. Fund your wallet, then pay from your wallet balance.',
        code: 'VTU_WALLET_ONLY',
      },
      { status: 400 }
    );
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to initialize payment',
      400
    );
  }
}
