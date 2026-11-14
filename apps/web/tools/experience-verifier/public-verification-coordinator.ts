import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { resolveCanonicalBase } from '@/lib/experience/canonical-domain';
import { productionOrigin } from '@/lib/experience/production-origins';
import { createPublicExperienceRuntime } from '@/lib/experience/public-runtime';
import { createPublicHeadResolver } from './public-head-resolver';
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
  observe(
    binding: Binding,
    output: Output,
    pages: Pages,
    expected: Plan,
    relay: ReturnType<typeof createPublicVerificationRelay>,
    framework: Awaited<ReturnType<typeof fetchFrameworkAssets>>,
    frames: Awaited<ReturnType<typeof fetchPublicFrames>>
  ): Promise<unknown>;
}) {
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
  return createPublicVerificationFlow({
    bind,
    fetchOutput: (binding) => fetchPublicOutput(binding, executionOrigin),
    deriveExpected: (binding) => derivePublicVerificationPlan(binding, runtime),
    fetchPages: (binding, expected) =>
      fetchPublicPages(binding.canonicalBase, expected.routes),
    observe: async (binding, output, pages, expected) =>
      settings.observe(
        binding,
        output,
        pages,
        expected,
        createPublicVerificationRelay({
          binding,
          product: expected.product,
          paths: expected.routes.map((route) => route.path),
          supabase: settings.supabase,
        }),
        await fetchFrameworkAssets(binding.canonicalBase, pages),
        await fetchPublicFrames(binding, executionOrigin, expected.routes)
      ),
    record,
  });
}
