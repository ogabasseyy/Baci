import { NextRequest } from 'next/server';
import { getSupabaseUrl } from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { readPiggyvestCustomerRequestBody } from '@/lib/piggyvest/customer-request-body';
import { createPrefundedCardCustomerHandler } from '@/lib/piggyvest/prefunded-card-customer-handler';
import { resolvePrefundedCardPublicContext } from '@/lib/piggyvest/prefunded-card-public-context';
import { readPrefundedCardPublicRuntime } from '@/lib/piggyvest/prefunded-card-public-runtime';
import { prefundedCardCustomerSchemas } from '@/schemas/prefunded-card-customer';

function denied(status: number) {
  return Response.json(
    {
      error: 'Savings card contribution unavailable',
      code: 'PREFUNDED_CARD_UNAVAILABLE',
    },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }
  );
}

async function handle(request: NextRequest, method: 'GET' | 'POST') {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) return denied(401);
    if (request.method !== method) return denied(405);
    if (method === 'POST' && !(await checkCsrfProtection(request)).valid)
      return denied(403);
    if (request.signal.aborted) return denied(503);
    let goalId: string;
    try {
      const query = new URL(request.url).searchParams;
      if (query.size !== new Set(query.keys()).size) return denied(400);
      if (method === 'POST') {
        if (query.size) return denied(400);
        const input = prefundedCardCustomerSchemas.request.parse(
          await readPiggyvestCustomerRequestBody(
            new NextRequest(request.clone())
          )
        );
        goalId = input.goalId;
      } else {
        const input = prefundedCardCustomerSchemas.selection.parse(
          Object.fromEntries(query)
        );
        goalId = input.goalId;
      }
    } catch {
      return denied(400);
    }
    const configured = readPrefundedCardPublicRuntime({
      authOrigin: getSupabaseUrl(),
    });
    if (!configured) return denied(503);
    if (
      request.headers.get('host') !== new URL(configured.publicOrigin).host ||
      (request.headers.has('origin') &&
        request.headers.get('origin') !== configured.publicOrigin)
    )
      return denied(403);
    const handler = createPrefundedCardCustomerHandler({
      supabase: auth.supabase,
      goalId,
      configuration: configured.configuration,
      termsDocument: undefined,
      execute: configured.card.execute,
      card: configured.card,
      checkCsrfProtection,
      resolveContext: resolvePrefundedCardPublicContext,
    });
    return handler[method](request);
  } catch {
    return denied(503);
  }
}

export const GET = (request: NextRequest) => handle(request, 'GET');
export const POST = (request: NextRequest) => handle(request, 'POST');
