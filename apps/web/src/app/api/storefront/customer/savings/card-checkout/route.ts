import { NextRequest } from 'next/server';
import { getSupabaseUrl } from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { readPiggyvestCustomerRequestBody } from '@/lib/piggyvest/customer-request-body';
import { readPrefundedCardCheckoutPublicRuntime } from '@/lib/piggyvest/prefunded-card-checkout-public-runtime';
import { prefundedCardCheckoutSchemas } from '@/schemas/prefunded-card-checkout';
import { prefundedCardCheckoutPublicSchemas } from '@/schemas/prefunded-card-checkout-public-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function denied(status: number) {
  return Response.json(
    {
      error: 'First-card savings checkout unavailable',
      code: 'PREFUNDED_CARD_CHECKOUT_UNAVAILABLE',
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

async function handle(request: NextRequest, method: 'GET' | 'PATCH' | 'POST') {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) return denied(401);
    if (request.method !== method) return denied(405);
    if (method !== 'GET' && !(await checkCsrfProtection(request)).valid)
      return denied(403);
    if (request.signal.aborted) return denied(503);

    let input:
      | ReturnType<
          typeof prefundedCardCheckoutPublicSchemas.capabilitySelection.parse
        >
      | ReturnType<typeof prefundedCardCheckoutSchemas.customerRequest.parse>
      | ReturnType<typeof prefundedCardCheckoutSchemas.customerSelection.parse>;
    try {
      if (method === 'GET') {
        const query = new URL(request.url).searchParams;
        if (query.size !== new Set(query.keys()).size) return denied(400);
        input = prefundedCardCheckoutPublicSchemas.capabilitySelection.parse(
          Object.fromEntries(query)
        );
      } else {
        const query = new URL(request.url).searchParams;
        if (query.size) return denied(400);
        const body = await readPiggyvestCustomerRequestBody(
          new NextRequest(request.clone())
        );
        input =
          method === 'POST'
            ? prefundedCardCheckoutSchemas.customerRequest.parse(body)
            : prefundedCardCheckoutSchemas.customerSelection.parse(body);
      }
    } catch {
      return denied(400);
    }

    const configured = readPrefundedCardCheckoutPublicRuntime({
      authOrigin: getSupabaseUrl(),
    });
    if (!configured) return denied(503);
    if (
      request.headers.get('host') !== new URL(configured.publicOrigin).host ||
      (request.headers.has('origin') &&
        request.headers.get('origin') !== configured.publicOrigin)
    ) {
      return denied(403);
    }
    if (method !== 'GET' && configured.mutationsEnabled !== true)
      return denied(503);

    if (method === 'GET') {
      const customer = configured.customer(auth.supabase);
      const result = prefundedCardCheckoutPublicSchemas.capability.parse(
        await customer.capability({ goalId: input.goalId })
      );
      if (result.goalId !== input.goalId) return denied(503);
      return Response.json(
        configured.mutationsEnabled === true
          ? result
          : {
              ...result,
              enabled: false,
              maximumAmountKobo: 0,
            },
        {
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        }
      );
    }
    const customer = configured.customer(auth.supabase);
    const mutation =
      method === 'POST'
        ? prefundedCardCheckoutSchemas.customerRequest.parse(input)
        : prefundedCardCheckoutSchemas.customerSelection.parse(input);
    const result = prefundedCardCheckoutPublicSchemas.state.parse(
      method === 'POST'
        ? await customer.start(mutation)
        : await customer.refresh(mutation)
    );
    if (result.goalId !== input.goalId) return denied(503);
    return Response.json(result, {
      status: result.status === 'pending' ? 202 : 200,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return denied(503);
  }
}

export const GET = (request: NextRequest) => handle(request, 'GET');
export const POST = (request: NextRequest) => handle(request, 'POST');
export const PATCH = (request: NextRequest) => handle(request, 'PATCH');
