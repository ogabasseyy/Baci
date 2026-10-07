import 'server-only';
import { piggyvestCancellationRecoverySchemas as schemas } from '@baci/shared/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { cancellationRecoveryRowsSchema } from '@/schemas/cancellation-recovery';
import { piggyvestCustomerPolicyContextSchemas } from '@/schemas/piggyvest-customer-policy-context';
import { CANCELLATION_RECOVERY_STATEMENTS } from './cancellation-recovery-statements';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { PIGGYVEST_POSTGRES_EXECUTOR } from './postgres-executor.constants';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

function respond(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export function createCancellationRecoveryHandler(options: {
  supabase: SupabaseClient;
  goalId: string;
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  return {
    async GET(request: NextRequest): Promise<Response> {
      const denied = (status: number) =>
        respond({ error: 'Cancellation recovery unavailable' }, status);
      let selection: ReturnType<typeof schemas.request.parse> | undefined;
      const unknown = () =>
        selection
          ? respond(
              schemas.response.parse({
                status: 'unavailable',
                goalId: selection.goalId,
                requestedOperationId: selection.operationId ?? null,
                operationId: null,
                reservation: 'may_be_retained',
                retry: 'not_authorized',
                dispatch: 'contract_gap',
              }),
              503
            )
          : denied(503);
      try {
        let actorId: string;
        try {
          const auth = await options.supabase.auth.getUser();
          const actor = piggyvestCustomerPolicyContextSchemas.actor.safeParse(
            auth.data?.user
          );
          if (auth.error || !actor.success) return denied(401);
          actorId = actor.data.id;
        } catch {
          return denied(401);
        }
        if (request.method !== 'GET') return denied(405);
        try {
          const parameters = new URL(request.url).searchParams;
          if (parameters.size !== new Set(parameters.keys()).size)
            return denied(400);
          selection = schemas.request.parse(Object.fromEntries(parameters));
        } catch {
          return denied(400);
        }
        const fixed = piggyvestCustomerPolicyContextSchemas.input.safeParse({
          goalId: options.goalId,
        });
        if (
          !fixed.success ||
          selection.goalId.toLowerCase() !== fixed.data.goalId
        )
          return denied(403);
        const resolve = () =>
          resolvePiggyvestCustomerPolicyContext({
            configuration: options.configuration,
            input: fixed.data,
            supabase: options.supabase,
          });
        const context = await resolve();
        if (context.status !== 'ready' || context.actorId !== actorId)
          return denied(403);
        const scope = context.configuration;
        async function revalidate() {
          const current = await resolve();
          return (
            current.status === 'ready' &&
            current.actorId === actorId &&
            JSON.stringify(current.configuration) === JSON.stringify(scope)
          );
        }
        if (!(await revalidate()) || request.signal.aborted) return denied(403);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let response: Awaited<ReturnType<PiggyvestProvisioningExecutor>>;
        try {
          response = await Promise.race([
            options.execute(
              CANCELLATION_RECOVERY_STATEMENTS.readCancellationRecovery.text,
              [
                scope.integrationId,
                scope.merchantId,
                scope.customerId,
                scope.goalId,
                scope.expectedBusinessId,
                actorId,
                selection.operationId?.toLowerCase() ?? null,
              ]
            ),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error('Recovery unavailable')),
                PIGGYVEST_POSTGRES_EXECUTOR.deadlineMs
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
        if (!(await revalidate()) || request.signal.aborted) return denied(403);
        const result = cancellationRecoveryRowsSchema.parse(response.rows)[0]
          .result;
        if (
          result.goalId.toLowerCase() !== scope.goalId ||
          result.requestedOperationId?.toLowerCase() !==
            selection.operationId?.toLowerCase()
        )
          return unknown();
        return respond(result, result.status === 'unavailable' ? 503 : 200);
      } catch {
        return unknown();
      }
    },
  };
}
