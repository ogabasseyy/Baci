import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { checkCsrfProtection } from '@/lib/csrf';
import { cancelPlanSchemas } from '@/schemas/cancel-plan';
import { piggyvestCustomerCancelHandlerSchemas as schemas } from '@/schemas/piggyvest-customer-cancel-handler';
import { createCancelPlan } from './cancel-plan';
import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { readPiggyvestCustomerRequestBody as readBody } from './customer-request-body';
import { PIGGYVEST_POSTGRES_EXECUTOR } from './postgres-executor.constants';

function respond(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function createPiggyvestCustomerCancelHandler(options: {
  supabase: SupabaseClient;
  goalId: string;
  configuration: unknown;
  execute: Parameters<typeof createCancelPlan>[0]['execute'];
  checkCsrfProtection: typeof checkCsrfProtection;
}) {
  async function handle(
    request: NextRequest,
    method: 'GET' | 'POST'
  ): Promise<Response> {
    const unavailable = (status: number) =>
      respond({ error: 'Cancellation unavailable' }, status);
    let confirmation: ReturnType<typeof schemas.confirmation.parse> | undefined;
    let attemptedPrepare = false;
    const uncertain = () =>
      confirmation
        ? respond(
            schemas.receipt.parse({
              status: 'unavailable',
              goalId: confirmation.goalId,
              operationId: confirmation.operationId,
              reservation: 'may_be_retained',
              dispatch: 'contract_gap',
            }),
            503
          )
        : unavailable(503);
    try {
      let actorId: string;
      try {
        const auth = await options.supabase.auth.getUser();
        const actor = schemas.actor.safeParse(auth.data?.user);
        if (auth.error || !actor.success) return unavailable(401);
        actorId = actor.data.id;
      } catch {
        return unavailable(401);
      }
      if (request.method !== method) return unavailable(405);
      if (
        method === 'POST' &&
        !(await options.checkCsrfProtection(request)).valid
      )
        return unavailable(403);
      let selection: { goalId: string };
      try {
        const parameters = new URL(request.url).searchParams;
        if (method === 'POST') {
          if (parameters.size !== 0) return unavailable(400);
          confirmation = schemas.confirmation.parse(await readBody(request));
          selection = schemas.read.parse({ goalId: confirmation.goalId });
        } else {
          if (parameters.size !== 1) return unavailable(400);
          selection = schemas.read.parse(Object.fromEntries(parameters));
        }
      } catch {
        return unavailable(400);
      }
      const fixed = schemas.read.safeParse({ goalId: options.goalId });
      if (!fixed.success || selection.goalId !== fixed.data.goalId)
        return unavailable(403);
      const resolve = () =>
        resolvePiggyvestCustomerPolicyContext({
          configuration: options.configuration,
          input: fixed.data,
          supabase: options.supabase,
        });
      const context = await resolve();
      if (context.status !== 'ready' || context.actorId !== actorId)
        return unavailable(403);
      const scope = context.configuration;
      const scopeParameters = [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
        scope.expectedBusinessId,
      ];
      async function revalidate() {
        const current = await resolve();
        return (
          current.status === 'ready' &&
          current.actorId === actorId &&
          current.configuration.integrationId === scope.integrationId &&
          current.configuration.merchantId === scope.merchantId &&
          current.configuration.customerId === scope.customerId &&
          current.configuration.goalId === scope.goalId &&
          current.configuration.expectedBusinessId === scope.expectedBusinessId
        );
      }
      const command = confirmation
        ? cancelPlanSchemas.confirmation.parse({
            operationId: confirmation.operationId,
            actorId,
            revisionId: confirmation.revisionId,
            termsVersion: confirmation.termsVersion,
            termsHash: confirmation.termsHash,
            consentVersion: confirmation.consentVersion,
            accepted: confirmation.accepted,
            principalKobo: confirmation.principalKobo,
            paidInterestKobo: confirmation.paidInterestKobo,
            pendingInterestKobo: confirmation.pendingInterestKobo,
          })
        : undefined;
      const plan = createCancelPlan({
        configuration: { ...scope, transport: 'local_test', actorId },
        execute: async (statement, parameters) => {
          if (
            !(await revalidate()) ||
            request.signal.aborted ||
            parameters.length !== 6 ||
            scopeParameters.some(
              (value, index) => parameters[index] !== value
            ) ||
            statement !==
              (command
                ? CANCEL_PLAN_STATEMENTS.prepareCancelPlan.text
                : CANCEL_PLAN_STATEMENTS.quoteCancelPlan.text) ||
            (command
              ? JSON.stringify(
                  cancelPlanSchemas.confirmation.parse(
                    JSON.parse(parameters[5])
                  )
                ) !== JSON.stringify(command)
              : parameters[5] !== actorId)
          )
            throw new Error('Cancellation unavailable');
          attemptedPrepare = command !== undefined;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              options.execute(statement, parameters),
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('Cancellation unavailable')),
                  PIGGYVEST_POSTGRES_EXECUTOR.deadlineMs
                );
              }),
            ]);
          } finally {
            clearTimeout(timeout);
          }
        },
      });
      if (command && confirmation) {
        const result = await plan.prepare(command);
        if (
          result.status !== 'prepared' ||
          !(await revalidate()) ||
          request.signal.aborted
        )
          return uncertain();
        return respond(
          schemas.receipt.parse({
            ...result,
            goalId: confirmation.goalId,
            operationId: confirmation.operationId,
          }),
          200
        );
      }
      const result = await plan.quote();
      if (!(await revalidate()) || request.signal.aborted)
        return unavailable(403);
      return respond(
        schemas.quote.parse({ ...result, goalId: scope.goalId }),
        result.status === 'unavailable' ? 503 : 200
      );
    } catch {
      return attemptedPrepare ? uncertain() : unavailable(503);
    }
  }
  return {
    GET: (request: NextRequest) => handle(request, 'GET'),
    POST: (request: NextRequest) => handle(request, 'POST'),
  };
}
