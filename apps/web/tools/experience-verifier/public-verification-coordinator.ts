import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { resolveCanonicalBase } from '@/lib/experience/canonical-domain';
import { productionOrigin } from '@/lib/experience/production-origins';
import { createPublicExperienceRuntime } from '@/lib/experience/public-runtime';
import { createPublicHeadResolver } from './public-head-resolver';
import { publicNetworkSignal } from './public-network-lifetime';
import { fetchPublicOutput } from './public-output-fetch';
import { fetchPublicPages } from './public-page-fetch';
import { createVerifierPublicRecorder } from './public-recorder';
import { createPublicVerificationFlow } from './public-verification-flow';
import { fetchPublicFrames } from './public-verification-frame';
import { fetchFrameworkAssets } from './public-verification-framework-assets';
import { derivePublicVerificationPlan } from './public-verification-plan';
import { createPublicVerificationRelay } from './public-verification-relay';

type Binding = Awaited<ReturnType<ReturnType<typeof createPublicHeadResolver>>>;
type Output = Awaited<ReturnType<typeof fetchPublicOutput>>;
type Pages = Awaited<ReturnType<typeof fetchPublicPages>>;
type Plan = Awaited<ReturnType<typeof derivePublicVerificationPlan>>;

/** Trusted composition only. The browser observer must be independently isolated. */
export async function createPublicVerificationCoordinator(settings: {
  owner: SupabaseClient;
  supabase: { url: string; anonKey: string };
  pool: Pool;
  rootDomain: string;
  executionOrigin: string;
  signal?: AbortSignal;
  observe(
    binding: Binding,
    output: Output,
    pages: Pages,
    expected: Plan,
    relay: ReturnType<typeof createPublicVerificationRelay>,
    framework: Awaited<ReturnType<typeof fetchFrameworkAssets>>,
    frames: Awaited<ReturnType<typeof fetchPublicFrames>>,
    signal?: AbortSignal
  ): Promise<unknown>;
}) {
  const signal = settings.signal;
  signal?.throwIfAborted();
  const network = { signal };
  const executionOrigin = productionOrigin(settings.executionOrigin);
  let supabaseUrl: string;
  try {
    supabaseUrl = productionOrigin(settings.supabase.url);
    if (!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(settings.supabase.anonKey))
      throw Error();
  } catch {
    throw Error('INVALID_PUBLIC_CLIENT');
  }
  const publicClient = createClient(supabaseUrl, settings.supabase.anonKey, {
    global: {
      fetch: (input, init) => {
        const inherited =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const combined =
          signal && inherited
            ? AbortSignal.any([signal, inherited])
            : (signal ?? inherited);
        return fetch(input, {
          ...init,
          signal: publicNetworkSignal(10000, combined),
        });
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const bind = createPublicHeadResolver(
    settings.owner,
    publicClient,
    settings.rootDomain
  );
  const runtime = createPublicExperienceRuntime({
    client: publicClient,
    runtimeBase: executionOrigin,
    canonicalBase: (slug) =>
      resolveCanonicalBase(publicClient, slug, settings.rootDomain),
    prerenderDelivery: true,
  });
  const record = await createVerifierPublicRecorder(settings.pool);
  signal?.throwIfAborted();
  const verify = createPublicVerificationFlow({
    bind,
    fetchOutput: (binding) =>
      fetchPublicOutput(binding, executionOrigin, network),
    deriveExpected: (binding) =>
      derivePublicVerificationPlan(binding, runtime, signal),
    fetchPages: (binding, expected) =>
      fetchPublicPages(
        binding.canonicalBase,
        expected.product.native
          ? [
              ...expected.routes,
              {
                path: expected.product.path,
                canonical: `${binding.canonicalBase}${expected.product.path}`,
                native: true,
              },
              ...(expected.product.nativeCheckout
                ? [
                    {
                      path: '/checkout',
                      canonical: `${binding.canonicalBase}/checkout`,
                      native: true as const,
                      checkout: true as const,
                    },
                  ]
                : []),
            ]
          : expected.routes,
        network
      ),
    observe: async (binding, output, pages, expected) => {
      const framework = await fetchFrameworkAssets(
        binding.canonicalBase,
        pages,
        network
      );
      signal?.throwIfAborted();
      const frames = await fetchPublicFrames(
        binding,
        executionOrigin,
        expected.routes,
        network
      );
      signal?.throwIfAborted();
      return settings.observe(
        binding,
        output,
        pages,
        expected,
        createPublicVerificationRelay({
          binding,
          product: expected.product,
          allowSharedCart: !expected.product.nativeCheckout,
          paths: expected.routes.map((route) => route.path),
          supabase: settings.supabase,
          signal,
        }),
        framework,
        frames,
        signal
      );
    },
    record,
  });
  return (id: string, accept?: () => void) => verify(id, signal, accept);
}
