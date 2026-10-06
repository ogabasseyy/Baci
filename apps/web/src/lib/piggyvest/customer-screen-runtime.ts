import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { SavingsScreenSource } from '@/components/storefront/piggyvest-savings/savings-screen.types';
import { piggyvestCustomerPolicyContextSchemas } from '@/schemas/piggyvest-customer-policy-context';
import { piggyvestPolicyReviewSchemas } from '@/schemas/piggyvest-policy-review';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { createPiggyvestCustomerPolicyHandler } from './customer-policy-handler';

type HandlerOptions = Parameters<
  typeof createPiggyvestCustomerPolicyHandler
>[0];

export function createPiggyvestCustomerScreenRuntime(options: {
  supabase: SupabaseClient;
  goalId: string;
  configuration: unknown;
  termsDocument: unknown;
  execute: HandlerOptions['execute'];
  checkCsrfProtection: HandlerOptions['checkCsrfProtection'];
}) {
  async function actor(): Promise<string | null> {
    try {
      const auth = await options.supabase.auth.getUser();
      const parsed = piggyvestCustomerPolicyContextSchemas.actor.safeParse(
        auth.data?.user
      );
      return auth.error || !parsed.success ? null : parsed.data.id;
    } catch {
      return null;
    }
  }

  async function handle(request: NextRequest, method: 'GET' | 'POST') {
    let authenticatedActor: string | null = null;
    async function revalidate() {
      const context = await resolvePiggyvestCustomerPolicyContext({
        configuration: options.configuration,
        input: { goalId: options.goalId },
        supabase: options.supabase,
      });
      return context.status === 'ready' &&
        authenticatedActor !== null &&
        context.actorId === authenticatedActor
        ? context.configuration
        : null;
    }
    const handler = createPiggyvestCustomerPolicyHandler({
      configuration: options.configuration,
      termsDocument: options.termsDocument,
      checkCsrfProtection: options.checkCsrfProtection,
      authenticate: async () => {
        authenticatedActor = await actor();
        return authenticatedActor ? options.supabase : null;
      },
      execute: async (statement, parameters) => {
        const scope = await revalidate();
        if (
          !scope ||
          parameters[0] !== scope.integrationId ||
          parameters[1] !== scope.merchantId ||
          parameters[2] !== scope.customerId ||
          parameters[3] !== scope.goalId ||
          parameters[4] !== scope.expectedBusinessId ||
          ((parameters.length === 7 || parameters.length === 8) &&
            parameters[6] !== authenticatedActor)
        ) {
          throw new Error('Customer screen unavailable');
        }
        return options.execute(statement, parameters);
      },
    });
    const response = await handler[method](request);
    if (response.ok && !(await revalidate())) {
      return Response.json(
        { error: 'Policy unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }
    return response;
  }

  return {
    GET: (request: NextRequest): Promise<Response> => handle(request, 'GET'),
    POST: (request: NextRequest): Promise<Response> => handle(request, 'POST'),
    async readScreen(request: NextRequest): Promise<SavingsScreenSource> {
      const unavailable = {
        environment: 'staging',
        status: 'unavailable',
      } as const;
      try {
        const response = await handle(request, 'GET');
        if (response.status === 401)
          return { environment: 'staging', status: 'unauthenticated' };
        if (!response.ok) return unavailable;
        const policy = piggyvestPolicyReviewSchemas.view.parse(
          await response.json()
        );
        if (policy.status !== 'draft') return unavailable;
        return piggyvestSavingsScreenSchema.parse({
          environment: 'staging',
          status: 'ready',
          sessionKey: randomUUID(),
          goalId: policy.goalId,
          policy,
          eligibility: { status: 'unavailable' },
          funding: { status: 'unavailable' },
          progress: { status: 'unavailable' },
        });
      } catch {
        return unavailable;
      }
    },
  };
}
