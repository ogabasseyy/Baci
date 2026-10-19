import 'server-only';
import type { NextRequest } from 'next/server';
import { prefundedCardCustomerSchemas as schemas } from '@/schemas/prefunded-card-customer';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { readPiggyvestCustomerRequestBody } from './customer-request-body';
import { PREFUNDED_CARD_CUSTOMER_STATEMENTS } from './prefunded-card-customer-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import type { RuntimeCompositionCommon } from './runtime-composition.types';

export function createPrefundedCardCustomerHandler(
  options: RuntimeCompositionCommon & {
    resolveContext?: typeof resolvePiggyvestCustomerPolicyContext;
    card: {
      enabled: true;
      expectedSystemId: string;
      execute: PiggyvestProvisioningExecutor;
    };
  }
) {
  const resolveContext =
    options.resolveContext ?? resolvePiggyvestCustomerPolicyContext;
  const respond = (body: unknown, status: number) =>
    Response.json(body, {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  const denied = (status: number) =>
    respond({ error: 'Savings card contribution unavailable' }, status);
  async function handle(request: NextRequest, method: 'GET' | 'POST') {
    try {
      let actorId: string;
      try {
        const auth = await options.supabase.auth.getUser();
        const actor = schemas.actor.safeParse(auth.data?.user);
        if (auth.error || !actor.success) return denied(401);
        actorId = actor.data.id;
      } catch {
        return denied(401);
      }
      if (request.method !== method) return denied(405);
      if (request.signal.aborted) return denied(503);
      if (
        method === 'POST' &&
        !(await options.checkCsrfProtection(request)).valid
      )
        return denied(403);
      const configuration = schemas.configuration.parse({
        enabled: options.card.enabled,
        expectedSystemId: options.card.expectedSystemId,
      });
      let input:
        | ReturnType<typeof schemas.request.parse>
        | ReturnType<typeof schemas.selection.parse>;
      try {
        const query = new URL(request.url).searchParams;
        if (method === 'POST') {
          if (query.size) return denied(400);
          input = schemas.request.parse(
            await readPiggyvestCustomerRequestBody(request)
          );
        } else {
          if (query.size !== new Set(query.keys()).size) return denied(400);
          input = schemas.selection.parse(Object.fromEntries(query));
        }
      } catch {
        return denied(400);
      }
      if (input.goalId !== options.goalId) return denied(403);
      const resolve = () =>
        resolveContext({
          configuration: options.configuration,
          input: { goalId: input.goalId },
          supabase: options.supabase,
        });
      const context = await resolve();
      if (context.status !== 'ready' || context.actorId !== actorId)
        return denied(403);
      if (request.signal.aborted) return denied(503);
      const scope = context.configuration;
      const capability = method === 'GET' && input.idempotencyKey === undefined;
      const statement =
        method === 'POST'
          ? PREFUNDED_CARD_CUSTOMER_STATEMENTS.request
          : capability
            ? PREFUNDED_CARD_CUSTOMER_STATEMENTS.capabilities
            : PREFUNDED_CARD_CUSTOMER_STATEMENTS.status;
      const response = await options.card.execute(statement, [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
        actorId,
        scope.expectedBusinessId,
        configuration.expectedSystemId,
        JSON.stringify(input),
      ]);
      if (
        request.signal.aborted ||
        JSON.stringify(await resolve()) !== JSON.stringify(context)
      )
        return denied(503);
      if (response.rows.length !== 1) return denied(503);
      const row = response.rows[0];
      if (!row || typeof row !== 'object' || !('result' in row))
        return denied(503);
      if (capability) {
        const result = schemas.capability.parse(row.result);
        return result.goalId === input.goalId
          ? respond(result, 200)
          : denied(503);
      }
      const result = schemas.result.parse(row.result);
      if (
        result.goalId !== input.goalId ||
        ('amountKobo' in input && result.amountKobo !== input.amountKobo)
      )
        return denied(503);
      return respond(
        result,
        result.status === 'pending' && method === 'POST' ? 202 : 200
      );
    } catch {
      return denied(503);
    }
  }
  return {
    GET: (request: NextRequest) => handle(request, 'GET'),
    POST: (request: NextRequest) => handle(request, 'POST'),
  };
}
