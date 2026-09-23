import { NextResponse } from 'next/server';
import { createBuilderAiBootstrapAttestation } from '@/lib/builder-ai/create-builder-ai-bootstrap-attestation';
import { getBuilderAiBootstrapRequest } from '@/lib/builder-ai/get-builder-ai-bootstrap-request';
import { materializeBuilderAiProviderChain } from '@/lib/builder-ai/materialize-builder-ai-provider-chain';
import { smokeBuilderAiBootstrapProviders } from '@/lib/builder-ai/smoke-builder-ai-bootstrap-providers';
import { createBuilderAiVercelBootstrapClient } from '@/lib/builder-ai/vercel-builder-ai-bootstrap';

export const maxDuration = 90;

const CONTROL_PLANE_CALL_LIMIT_MS = 8_000;
const MAX_CONTROL_PLANE_LIST_PAGES = 2;
const MAX_CONTROL_PLANE_CALLS = MAX_CONTROL_PLANE_LIST_PAGES + 2; // paginated list pages + delete + persistence
const PROVIDER_SMOKE_LIMIT_MS = 30_000;
export const BUILDER_AI_ATTESTATION_MAX_WORK_MS =
  CONTROL_PLANE_CALL_LIMIT_MS * MAX_CONTROL_PLANE_CALLS +
  PROVIDER_SMOKE_LIMIT_MS;

function response(body: object, status: number) {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
    status,
  });
}

function hidden() {
  return new NextResponse(null, {
    headers: { 'Cache-Control': 'no-store' },
    status: 404,
  });
}

function failure(
  phase: 'attest' | 'verify',
  runId: string,
  status: 502 | 503,
  code: string
) {
  return response(
    { code, error: 'Builder AI bootstrap failed', phase, runId },
    status
  );
}

function providerAlias(
  name: string
): 'cerebras' | 'google' | 'groq' | 'openrouter' | null {
  if (name.startsWith('cerebras:')) return 'cerebras';
  if (name.startsWith('google:')) return 'google';
  if (name.startsWith('groq:')) return 'groq';
  if (name.startsWith('openrouter:')) return 'openrouter';
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const bootstrap = await getBuilderAiBootstrapRequest(request);
  if (!bootstrap) return hidden();
  const vercel = createBuilderAiVercelBootstrapClient();
  if (!vercel) {
    return failure(
      bootstrap.phase,
      bootstrap.runId,
      503,
      'bootstrap_control_unavailable'
    );
  }
  if (!(await vercel.claimToken(bootstrap.runId))) return hidden();

  const attestation =
    bootstrap.phase === 'attest' ? createBuilderAiBootstrapAttestation() : null;
  if (bootstrap.phase === 'attest' && !attestation) {
    return failure(
      bootstrap.phase,
      bootstrap.runId,
      503,
      'attestation_unavailable'
    );
  }
  const materialized = materializeBuilderAiProviderChain(
    attestation?.environment,
    undefined,
    'smoke'
  );
  if (materialized.providers.length === 0) {
    return failure(
      bootstrap.phase,
      bootstrap.runId,
      503,
      'provider_configuration_unavailable'
    );
  }
  const providers = await smokeBuilderAiBootstrapProviders(
    materialized.providers
  );
  if (
    providers.length !== materialized.providers.length ||
    providers.some((provider) => provider.result !== 'pass')
  ) {
    return failure(
      bootstrap.phase,
      bootstrap.runId,
      502,
      'provider_smoke_failed'
    );
  }
  const publicProviders = providers.map((provider) => ({
    ...provider,
    provider: providerAlias(provider.provider),
  }));
  if (publicProviders.some((provider) => provider.provider === null)) {
    return failure(
      bootstrap.phase,
      bootstrap.runId,
      502,
      'provider_alias_invalid'
    );
  }
  const persisted =
    bootstrap.phase === 'attest'
      ? Boolean(
          attestation && (await vercel.upsertAttestation(attestation.values))
        )
      : await vercel.disableBootstrap();
  if (!persisted) {
    return failure(
      bootstrap.phase,
      bootstrap.runId,
      503,
      'bootstrap_persistence_failed'
    );
  }
  return response(
    {
      phase: bootstrap.phase,
      providers: publicProviders,
      runId: bootstrap.runId,
      status: bootstrap.phase === 'attest' ? 'attested' : 'verified',
    },
    200
  );
}
