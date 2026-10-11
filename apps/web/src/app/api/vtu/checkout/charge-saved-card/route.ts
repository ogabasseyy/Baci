import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user) {
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

    // Wallet-only VTU checkout: saved-card charges for utilities are
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
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to charge saved card',
      },
      { status: 400 }
    );
  }
}
