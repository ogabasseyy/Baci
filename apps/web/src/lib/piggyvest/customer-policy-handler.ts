import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { checkCsrfProtection } from '@/lib/csrf';
import { piggyvestCustomerPolicyRequestSchemas as schemas } from '@/schemas/piggyvest-customer-policy-request';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { readPiggyvestCustomerRequestBody as readBody } from './customer-request-body';
import { createGoalPolicyStore } from './goal-policy-store';

function respond(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function unavailable(status: number): Response {
  return respond({ error: 'Policy unavailable' }, status);
}

export function createPiggyvestCustomerPolicyHandler(options: {
  authenticate: (request: NextRequest) => Promise<SupabaseClient | null>;
  checkCsrfProtection: typeof checkCsrfProtection;
  configuration: unknown;
  termsDocument: unknown;
  execute: Parameters<typeof createGoalPolicyStore>[0]['execute'];
}) {
  async function handle(
    request: NextRequest,
    method: 'GET' | 'POST'
  ): Promise<Response> {
    try {
      const supabase = await options.authenticate(request);
      if (!supabase) return unavailable(401);
      if (request.method !== method) return unavailable(405);
      if (method === 'POST') {
        const csrf = await options.checkCsrfProtection(request);
        if (!csrf.valid) return unavailable(403);
      }
      let selection: { goalId: string };
      let acceptance: ReturnType<typeof schemas.accept.parse> | undefined;
      try {
        const parameters = new URL(request.url).searchParams;
        if (method === 'POST') {
          if (parameters.size !== 0) return unavailable(400);
          acceptance = schemas.accept.parse(await readBody(request));
          selection = { goalId: acceptance.goalId };
        } else {
          if (parameters.size !== 1) return unavailable(400);
          selection = schemas.read.parse(Object.fromEntries(parameters));
        }
      } catch {
        return unavailable(400);
      }
      const context = await resolvePiggyvestCustomerPolicyContext({
        configuration: options.configuration,
        input: selection,
        supabase,
      });
      if (context.status !== 'ready') return unavailable(403);
      const store = createGoalPolicyStore({
        configuration: context.configuration,
        execute: options.execute,
      });
      const snapshot = await store.read();
      const document = schemas.terms.safeParse(options.termsDocument);
      if (
        !snapshot ||
        !document.success ||
        createHash('sha256')
          .update(document.data.text, 'utf8')
          .digest('hex') !== document.data.hash ||
        snapshot.command.termsVersion !== document.data.version ||
        snapshot.command.termsHash !== document.data.hash ||
        (snapshot.actorId !== null && snapshot.actorId !== context.actorId) ||
        (snapshot.device.variantId === null) !==
          (snapshot.device.variantLabel === null)
      )
        return unavailable(409);
      let accepted = snapshot.acceptedAt !== null;
      if (acceptance) {
        if (
          acceptance.revisionId !== snapshot.revisionId ||
          acceptance.termsVersion !== document.data.version ||
          acceptance.termsHash !== document.data.hash ||
          acceptance.durationMonths !== snapshot.durationMonths
        )
          return unavailable(409);
        await store.accept({
          revisionId: snapshot.revisionId,
          actorId: context.actorId,
          ...(snapshot.durationMonths === undefined
            ? {}
            : { durationMonths: snapshot.durationMonths }),
        });
        accepted = true;
      }
      return respond(
        {
          status: 'draft',
          goalId: context.configuration.goalId,
          revisionId: snapshot.revisionId,
          device: {
            productName: snapshot.device.name,
            variant: snapshot.device.variantLabel,
            condition: snapshot.device.condition,
          },
          terms: document.data,
          consent: accepted ? 'accepted' : 'required',
          ...(snapshot.durationMonths === undefined
            ? {}
            : { durationMonths: snapshot.durationMonths }),
        },
        200
      );
    } catch {
      return unavailable(503);
    }
  }
  return {
    GET: (request: NextRequest) => handle(request, 'GET'),
    POST: (request: NextRequest) => handle(request, 'POST'),
  };
}
