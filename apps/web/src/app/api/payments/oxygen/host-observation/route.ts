import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { observedOxygenHostnames } from '@/lib/payments/oxygen/observed-hostnames';
import { readOxygenResponseEvidence } from '@/lib/payments/oxygen/response-evidence';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { readOxygenSnapshot } from '@/lib/payments/oxygen/runtime-service';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import { oxygenHostObservationQuery } from '@/schemas/oxygen-host-observation';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};
const unavailable = () =>
  NextResponse.json({ error: 'Unavailable' }, { status: 404, headers });

/** Opt-in pilot-only inspection. No provider links or response bodies leave the server. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const configuredUser = process.env.OXYGEN_PRODUCTION_HOST_DIAGNOSTIC_USER_ID;
  if (
    process.env.OXYGEN_PRODUCTION_HOST_DIAGNOSTIC_ENABLED !== 'true' ||
    !configuredUser ||
    auth.user.id !== configuredUser
  )
    return unavailable();
  try {
    if (
      !(await checkOxygenProviderRateLimit(auth.user.id, 'host-observation', 6))
        .allowed
    )
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers }
      );
  } catch {
    return unavailable();
  }
  const parsed = oxygenHostObservationQuery.safeParse({
    workflowId: request.nextUrl.searchParams.get('workflowId'),
    commandId: request.nextUrl.searchParams.get('commandId'),
  });
  if (!parsed.success) return unavailable();
  try {
    const snapshot = await readOxygenSnapshot(
      auth.supabase,
      parsed.data.workflowId
    );
    const connection = connectOxygenRuntime();
    const config = readOxygenRuntimeConfiguration();
    if (
      snapshot.environment !== 'production' ||
      connection?.environment !== 'production' ||
      config?.environment !== 'production'
    )
      return unavailable();
    const evidence = await readOxygenResponseEvidence(
      await connection.worker(),
      parsed.data.workflowId,
      parsed.data.commandId,
      config.evidenceKey
    );
    return NextResponse.json(
      { hostnames: observedOxygenHostnames(evidence) },
      { headers }
    );
  } catch {
    return unavailable();
  }
}
