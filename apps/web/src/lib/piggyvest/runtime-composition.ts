import 'server-only';
import { NextRequest } from 'next/server';
import { piggyvestCustomerPolicyContextSchemas as contextSchemas } from '@/schemas/piggyvest-customer-policy-context';
import { piggyvestRuntimeCompositionSchemas as schemas } from '@/schemas/piggyvest-runtime-composition';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { RUNTIME_COMPOSITION_METHODS } from './runtime-composition.constants';
import type { RuntimeCompositionOptions } from './runtime-composition.types';
import { createRuntimeCompositionRlsFactory } from './runtime-composition-auth';
import { createRuntimeCompositionCsrf } from './runtime-composition-csrf';
import { dispatchRuntimeComposition } from './runtime-composition-routes';

export function createPiggyvestRuntimeComposition(
  options: RuntimeCompositionOptions
) {
  const parsed = schemas.configuration.safeParse(options.configuration);
  const origin = schemas.origin.safeParse(options.origin);
  const browserOrigin = schemas.origin.safeParse(
    options.browserOrigin ?? options.origin
  );
  if (
    !parsed.success ||
    !origin.success ||
    !browserOrigin.success ||
    (typeof options.createRlsClient === 'function') ===
      (options.authentication !== undefined) ||
    typeof options.execute !== 'function'
  )
    throw new Error('Local savings runtime unavailable');
  const configuration = parsed.data;
  const createRlsClient = options.createRlsClient;
  const rlsFactory =
    options.authentication !== undefined
      ? createRuntimeCompositionRlsFactory(options.authentication, {
          fetchImplementation: options.authenticationFetch,
          cookiePath: options.csrfCookiePath,
          projectId: configuration.context.actualProjectId,
        })
      : null;
  const csrf = createRuntimeCompositionCsrf({
    origin: browserOrigin.data,
    goalId: configuration.goalId,
    secret: options.csrfSecret,
    cookiePath: options.csrfCookiePath,
  });
  const denied = (status: number) =>
    Response.json(
      { error: 'Local savings runtime unavailable' },
      {
        status,
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      }
    );
  return async function handle(request: Request): Promise<Response> {
    let applyCookies = (response: Response): Response => response;
    async function run() {
      try {
        if (request.signal.aborted) return denied(503);
        const url = new URL(request.url);
        if (
          url.origin !== origin.data ||
          request.headers.has('authorization') ||
          [...request.headers.keys()].some(
            (key) => key === 'forwarded' || key.startsWith('x-forwarded-')
          ) ||
          (request.headers.has('origin') &&
            request.headers.get('origin') !== browserOrigin.data) ||
          request.headers.get('sec-fetch-site') === 'cross-site'
        )
          return denied(403);
        const methods = Object.hasOwn(RUNTIME_COMPOSITION_METHODS, url.pathname)
          ? RUNTIME_COMPOSITION_METHODS[url.pathname]
          : undefined;
        if (!methods) return denied(404);
        if (!methods.includes(request.method)) return denied(405);
        const nextRequest = new NextRequest(request);
        const session = rlsFactory?.(nextRequest);
        if (session) applyCookies = session.applyCookies;
        const resolvedSupabase = session
          ? session.supabase
          : await createRlsClient?.(nextRequest);
        if (!resolvedSupabase) return denied(503);
        const supabase = resolvedSupabase;
        if (request.signal.aborted) return denied(503);
        async function actor() {
          const auth = await supabase.auth.getUser();
          const result = contextSchemas.actor.safeParse(auth.data?.user);
          return !auth.error && result.success ? result.data.id : null;
        }
        let initialActor: string | null;
        try {
          initialActor = await actor();
        } catch {
          return denied(401);
        }
        if (!initialActor) return denied(401);
        if (url.pathname === '/csrf') {
          if (url.searchParams.size !== 0) return denied(400);
          if (
            request.headers.get('origin') !== browserOrigin.data &&
            request.headers.get('sec-fetch-site') !== 'same-origin'
          )
            return denied(403);
          const context = await resolvePiggyvestCustomerPolicyContext({
            configuration: configuration.context,
            input: { goalId: configuration.goalId },
            supabase,
          });
          if (
            context.status !== 'ready' ||
            context.actorId !== initialActor ||
            (await actor()) !== initialActor
          )
            return denied(403);
          if (request.signal.aborted) return denied(503);
          return csrf.bootstrap(nextRequest, initialActor);
        }
        const common = {
          supabase,
          goalId: configuration.goalId,
          configuration: configuration.context,
          termsDocument: configuration.termsDocument,
          execute: async (
            ...args: Parameters<PiggyvestProvisioningExecutor>
          ) => {
            if (request.signal.aborted)
              throw new Error('Local savings runtime unavailable');
            const result = await options.execute(...args);
            if (request.signal.aborted)
              throw new Error('Local savings runtime unavailable');
            return result;
          },
          checkCsrfProtection: async (input: NextRequest) => {
            const currentActor = await actor();
            if (
              !currentActor ||
              currentActor !== initialActor ||
              request.signal.aborted
            )
              return { valid: false };
            return await csrf.check(input, currentActor);
          },
        };
        return await dispatchRuntimeComposition(
          nextRequest,
          common,
          options.services
        );
      } catch {
        return denied(503);
      }
    }
    return applyCookies(await run());
  };
}
