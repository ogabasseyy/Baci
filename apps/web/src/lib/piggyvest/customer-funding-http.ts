import 'server-only';
import type { NextRequest } from 'next/server';
import { piggyvestCustomerPolicyContextSchemas } from '@/schemas/piggyvest-customer-policy-context';
import { piggyvestCustomerPolicyRequestSchemas } from '@/schemas/piggyvest-customer-policy-request';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { createPiggyvestCustomerFundingScreen } from './customer-funding-screen';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';

export function createPiggyvestCustomerFundingHttp(
  options: Parameters<typeof createPiggyvestCustomerFundingScreen>[0]
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
  function denied(status: number) {
    return respond({ error: 'Funding unavailable' }, status);
  }
  return {
    async GET(request: NextRequest): Promise<Response> {
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
      try {
        if (request.method !== 'GET') return denied(405);
        const url = new URL(request.url);
        if (url.pathname !== '/funding') return denied(404);
        const selection = piggyvestCustomerPolicyRequestSchemas.read.safeParse(
          Object.fromEntries(url.searchParams)
        );
        if (url.searchParams.size !== 1 || !selection.success)
          return denied(400);
        if (selection.data.goalId !== options.goalId) return denied(403);
        if (request.signal.aborted) return denied(503);
        const resolve = () =>
          resolvePiggyvestCustomerPolicyContext({
            supabase: options.supabase,
            configuration: options.configuration,
            input: selection.data,
          });
        const before = await resolve();
        if (before.status !== 'ready' || before.actorId !== actorId)
          return denied(403);
        const screen =
          await createPiggyvestCustomerFundingScreen(options).readScreen(
            request
          );
        const after = await resolve();
        if (
          after.status !== 'ready' ||
          JSON.stringify(before) !== JSON.stringify(after)
        )
          return denied(403);
        if (request.signal.aborted) return denied(503);
        if (screen.status === 'unauthenticated') return denied(401);
        if (screen.status !== 'ready') return denied(503);
        return respond(piggyvestSavingsScreenSchema.parse(screen), 200);
      } catch {
        return denied(503);
      }
    },
  };
}
