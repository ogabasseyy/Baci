import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { z } from 'zod';
import type { checkCsrfProtection } from '@/lib/csrf';
import { piggyvestCustomerPolicyContextSchemas as schemas } from '@/schemas/piggyvest-customer-policy-context';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { readPiggyvestCustomerRequestBody } from './customer-request-body';
import { PIGGYVEST_POSTGRES_EXECUTOR } from './postgres-executor.constants';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPiggyvestCustomerOperationHandler(options: {
  supabase: SupabaseClient;
  goalId: string;
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
  checkCsrfProtection: typeof checkCsrfProtection;
}) {
  return async function handle<Input extends { goalId: string }>(
    request: NextRequest,
    operation: {
      method: 'GET' | 'POST';
      schema: z.ZodType<Input>;
      uncertain: (input: Input) => unknown;
      run: (
        input: Input,
        context: {
          actorId: string;
          scope: Extract<
            Awaited<ReturnType<typeof resolvePiggyvestCustomerPolicyContext>>,
            { status: 'ready' }
          >['configuration'];
          execute: (
            allowed: (
              statement: string,
              parameters: readonly unknown[]
            ) => boolean
          ) => PiggyvestProvisioningExecutor;
        }
      ) => Promise<unknown>;
    }
  ): Promise<Response> {
    const respond = (body: unknown, status: number) =>
      Response.json(body, {
        status,
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    const denied = (status: number) =>
      respond({ error: 'Savings operation unavailable' }, status);
    let input: Input | undefined;
    let dispatched = false;
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
      if (request.method !== operation.method) return denied(405);
      if (
        operation.method === 'POST' &&
        !(await options.checkCsrfProtection(request)).valid
      )
        return denied(403);
      try {
        const query = new URL(request.url).searchParams;
        if (operation.method === 'POST' && query.size !== 0) return denied(400);
        if (new Set(query.keys()).size !== query.size) return denied(400);
        input = operation.schema.parse(
          operation.method === 'POST'
            ? await readPiggyvestCustomerRequestBody(request)
            : Object.fromEntries(query)
        );
      } catch {
        return denied(400);
      }
      const fixed = schemas.input.safeParse({ goalId: options.goalId });
      if (!fixed.success || input.goalId !== fixed.data.goalId)
        return denied(403);
      const resolve = () =>
        resolvePiggyvestCustomerPolicyContext({
          supabase: options.supabase,
          configuration: options.configuration,
          input: fixed.data,
        });
      const context = await resolve();
      if (
        context.status !== 'ready' ||
        context.actorId !== actorId ||
        request.signal.aborted
      )
        return denied(403);
      const scope = context.configuration;
      const scopeValues = [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
        scope.expectedBusinessId,
      ];
      async function revalidate() {
        const current = await resolve();
        return (
          !request.signal.aborted &&
          current.status === 'ready' &&
          current.actorId === actorId &&
          JSON.stringify(current.configuration) === JSON.stringify(scope)
        );
      }
      const result = await operation.run(input, {
        actorId,
        scope,
        execute: (allowed) => async (statement, parameters) => {
          if (
            !allowed(statement, parameters) ||
            scopeValues.some((value, index) => parameters[index] !== value) ||
            !(await revalidate())
          )
            throw new Error('Unavailable');
          dispatched = true;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const result = await Promise.race([
              options.execute(statement, parameters),
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('Unavailable')),
                  PIGGYVEST_POSTGRES_EXECUTOR.deadlineMs
                );
              }),
            ]);
            if (request.signal.aborted) throw new Error('Unavailable');
            return result;
          } finally {
            clearTimeout(timeout);
          }
        },
      });
      if (!(await revalidate())) throw new Error('Unavailable');
      const unavailable =
        typeof result === 'object' &&
        result !== null &&
        'status' in result &&
        result.status === 'unavailable';
      return respond(result, unavailable ? 503 : 200);
    } catch {
      return input && dispatched
        ? respond(operation.uncertain(input), 503)
        : denied(503);
    }
  };
}
