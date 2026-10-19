import 'server-only';
import type { NextRequest } from 'next/server';
import type { checkCsrfProtection } from '@/lib/csrf';
import { piggyvestCustomerScheduleHandlerSchemas as schemas } from '@/schemas/piggyvest-customer-schedule-handler';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { readPiggyvestCustomerRequestBody } from './customer-request-body';
import { createAuthenticatedScheduleStore } from './schedule-store-authenticated';
import { SCHEDULE_STORE_STATEMENTS as statements } from './schedule-store-statements';

export function createPiggyvestCustomerScheduleHandler(
  options: Parameters<typeof createAuthenticatedScheduleStore>[0] & {
    checkCsrfProtection: typeof checkCsrfProtection;
  }
) {
  function respond(body: unknown, status: number) {
    return Response.json(body, {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  async function handle(request: NextRequest, method: 'GET' | 'POST') {
    const denied = (status: number) =>
      respond({ error: 'Schedule unavailable' }, status);
    let input: ReturnType<typeof schemas.request.parse> | undefined;
    let attempted = false;
    const common = {
      goalId: options.goalId,
      dispatch: 'disabled',
      debitPermission: false,
    };
    const uncertain = () =>
      input
        ? respond(
            schemas.uncertain.parse({
              ...common,
              status: 'unconfirmed',
              operationId: input.operationId,
              readbackRequired: true,
            }),
            503
          )
        : denied(503);
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
      if (request.signal.aborted) return denied(503);
      if (request.method !== method) return denied(405);
      if (
        method === 'POST' &&
        !(await options.checkCsrfProtection(request)).valid
      )
        return denied(403);
      let selection: ReturnType<typeof schemas.read.parse>;
      try {
        const query = new URL(request.url).searchParams;
        if (method === 'POST') {
          if (query.size !== 0) return denied(400);
          input = schemas.request.parse(
            await readPiggyvestCustomerRequestBody(request)
          );
          selection = { goalId: input.command.goalId };
        } else {
          if (query.size !== new Set(query.keys()).size) return denied(400);
          selection = schemas.read.parse(Object.fromEntries(query));
        }
      } catch {
        return denied(400);
      }
      const fixed = schemas.read.safeParse({ goalId: options.goalId });
      if (!fixed.success || selection.goalId !== fixed.data.goalId)
        return denied(403);
      const resolve = () =>
        resolvePiggyvestCustomerPolicyContext({
          supabase: options.supabase,
          configuration: options.configuration,
          input: fixed.data,
        });
      const context = await resolve();
      if (context.status !== 'ready' || context.actorId !== actorId)
        return denied(403);
      const scope = context.configuration;
      const expected = [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
        scope.expectedBusinessId,
        actorId,
      ];
      async function revalidate() {
        if (request.signal.aborted) throw new Error('Schedule unavailable');
        const current = await resolve();
        if (
          request.signal.aborted ||
          JSON.stringify(current) !== JSON.stringify(context)
        )
          throw new Error('Schedule unavailable');
      }
      const store = createAuthenticatedScheduleStore({
        ...options,
        execute: async (statement, parameters) => {
          await revalidate();
          if (
            parameters.length !== 7 ||
            expected.some((value, index) => parameters[index] !== value)
          )
            throw new Error('Schedule unavailable');
          if (statement === statements.readScheduleProposal.text) {
            if (
              parameters[6] !==
              (input?.operationId ?? selection.operationId ?? null)
            )
              throw new Error('Schedule unavailable');
          } else if (
            statement === statements.writeScheduleProposal.text &&
            input &&
            typeof parameters[6] === 'string'
          ) {
            const payload = JSON.parse(parameters[6]);
            if (
              JSON.stringify(
                schemas.request.parse({
                  operationId: payload.operationId,
                  command: payload.command,
                })
              ) !== JSON.stringify(input)
            )
              throw new Error('Schedule unavailable');
            attempted = true;
          } else throw new Error('Schedule unavailable');
          const result = await options.execute(statement, parameters);
          await revalidate();
          return result;
        },
      });
      if (input) {
        const result = await store.submit(input);
        if (result.status !== 'persisted_proposal') return uncertain();
        await revalidate();
        return respond(schemas.success.parse({ ...common, ...result }), 200);
      }
      const snapshot = await store.read(selection.operationId ?? null);
      await revalidate();
      return respond(
        schemas.snapshot.parse({
          ...common,
          status: 'available',
          revisionId: snapshot.trusted.revisionId,
          termsHash: snapshot.trusted.termsHash,
          state: snapshot.state,
          historical: snapshot.historical,
        }),
        200
      );
    } catch {
      return attempted ? uncertain() : denied(503);
    }
  }
  return {
    GET: (request: NextRequest) => handle(request, 'GET'),
    POST: (request: NextRequest) => handle(request, 'POST'),
  };
}
