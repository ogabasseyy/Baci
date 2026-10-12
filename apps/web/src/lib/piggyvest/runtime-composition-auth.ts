import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { runtimeCompositionAuthSchema } from '@/schemas/piggyvest-runtime-composition-auth';
import { runtimeCompositionCsrfSchemas } from '@/schemas/piggyvest-runtime-composition-csrf';

export function createRuntimeCompositionRlsFactory(
  configuration: unknown,
  options: {
    fetchImplementation?: typeof fetch;
    cookiePath?: string;
    projectId?: string;
  } = {}
) {
  const parsed = runtimeCompositionAuthSchema.safeParse(configuration);
  const path = runtimeCompositionCsrfSchemas.cookiePath.safeParse(
    options.cookiePath ?? '/'
  );
  if (!parsed.success || !path.success)
    throw new Error('Local savings authentication unavailable');
  const config = parsed.data;
  if (
    config.url.startsWith('https:') &&
    new URL(config.url).hostname !== `${options.projectId}.supabase.co`
  )
    throw new Error('Local savings authentication unavailable');
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  return function createRequestClient(request: NextRequest) {
    const writes = new NextResponse(null);
    const supabase = createServerClient(config.url, config.publicKey, {
      global: {
        fetch: async (input, init) => {
          const target = new URL(
            input instanceof Request ? input.url : String(input)
          );
          if (target.origin !== config.url || request.signal.aborted)
            throw new Error('Authentication unavailable');
          const signals = [request.signal];
          if (init?.signal) signals.push(init.signal);
          if (input instanceof Request) signals.push(input.signal);
          const signal = AbortSignal.any(signals);
          signal.throwIfAborted();
          const response = await fetchImplementation(input, {
            ...init,
            signal,
            redirect: 'error',
          });
          if (signal.aborted) {
            if (response.body && !response.body.locked)
              void response.body.cancel().catch(() => undefined);
            throw new Error('Authentication unavailable');
          }
          return response;
        },
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (updates) => {
          if (request.signal.aborted) return;
          for (const { name, value, options: cookie } of updates) {
            request.cookies.set(name, value);
            writes.cookies.set(name, value, {
              ...cookie,
              domain: undefined,
              httpOnly: true,
              sameSite: 'strict',
              secure: false,
              path: path.data,
            });
          }
        },
      },
    });
    return {
      supabase,
      applyCookies(response: Response): Response {
        const headers = new Headers(response.headers);
        for (const cookie of writes.headers.getSetCookie())
          headers.append('set-cookie', cookie);
        headers.set('cache-control', 'no-store');
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      },
    };
  };
}
