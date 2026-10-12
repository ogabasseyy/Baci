import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { customerSavingsDraftRequest } from '@/lib/customer-savings-draft-request';
import { customerSavingsDraftView } from '@/lib/customer-savings-draft-view';
import { readPiggyvestCustomerRequestBody } from '@/lib/piggyvest/customer-request-body';
import { customerSavingsDraftSchemas as schemas } from '@/schemas/customer-savings-draft';

type Action = 'create' | 'list' | 'policy' | 'accept';
const {
  failure,
  enabled: draftRuntimeEnabled,
  merchantId: SYNTHETIC_SAVINGS_DRAFT_MERCHANT_ID,
} = customerSavingsDraftRequest;
const failures: Record<string, { status: number; code: string }> = {
  '42501': { status: 403, code: 'SAVINGS_DRAFT_UNAVAILABLE' },
  '22023': { status: 400, code: 'SAVINGS_DRAFT_INVALID_INPUT' },
  '22P02': { status: 400, code: 'SAVINGS_DRAFT_INVALID_INPUT' },
  P0002: { status: 404, code: 'SAVINGS_DRAFT_NOT_FOUND' },
  '23505': { status: 409, code: 'SAVINGS_DRAFT_CONFLICT' },
  '23514': { status: 409, code: 'SAVINGS_DRAFT_REVIEW_REQUIRED' },
};

function readInput(request: NextRequest, action: Action) {
  const query = new URL(request.url).searchParams;
  if (action === 'list' || action === 'policy') {
    const entries = [...query];
    if (new Set(entries.map(([key]) => key)).size !== entries.length)
      throw new Error('Invalid query');
    return Object.fromEntries(entries);
  }
  if (query.size !== 0) throw new Error('Invalid query');
  return readPiggyvestCustomerRequestBody(request);
}

export async function handleCustomerSavingsDraft(
  request: NextRequest,
  action: Action
): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase)
      return failure(401, 'SAVINGS_DRAFT_UNAUTHORIZED');
    if (!draftRuntimeEnabled(request))
      return failure(403, 'SAVINGS_DRAFT_DISABLED');
    if (action === 'create' || action === 'accept') {
      const csrf = await checkCsrfProtection(request);
      if (!csrf.valid) return failure(403, 'SAVINGS_DRAFT_CSRF_FAILED');
    }
    let input: ReturnType<(typeof schemas)[Action]['parse']>;
    try {
      input = schemas[action].parse(await readInput(request, action));
    } catch {
      return failure(400, 'SAVINGS_DRAFT_INVALID_INPUT');
    }
    if (input.merchantId !== SYNTHETIC_SAVINGS_DRAFT_MERCHANT_ID)
      return failure(403, 'SAVINGS_DRAFT_DISABLED');
    const { merchantId, ...command } = input;
    const { data, error } = await auth.supabase.rpc(
      'customer_savings_draft_command',
      {
        p_merchant_id: merchantId,
        p_action: action,
        p_input: command,
      }
    );
    if (error) {
      const mapped = failures[error.code];
      return failure(
        mapped?.status ?? 503,
        mapped?.code ?? 'SAVINGS_DRAFT_UNAVAILABLE'
      );
    }
    const response =
      action === 'list'
        ? {
            drafts: schemas.listResult
              .parse(data)
              .drafts.map(customerSavingsDraftView),
          }
        : { draft: customerSavingsDraftView(schemas.result.parse(data).draft) };
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return failure(503, 'SAVINGS_DRAFT_UNAVAILABLE');
  }
}
