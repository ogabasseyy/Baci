import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { readOxygenResponseEvidence } from '@/lib/payments/oxygen/response-evidence';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { readOxygenSnapshot } from '@/lib/payments/oxygen/runtime-service';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import {
  oxygenEligibilityEvidenceQuery,
  oxygenEligibilityEvidenceRecord,
} from '@/schemas/oxygen-eligibility-evidence';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const unavailable = () =>
  NextResponse.json({ error: 'Unavailable' }, { status: 404, headers });

/** Explicit operator-only diagnostics for the caller's owned production workflow. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  if (
    process.env.OXYGEN_PRODUCTION_ELIGIBILITY_DIAGNOSTIC_ENABLED !== 'true' ||
    !process.env.OXYGEN_PRODUCTION_ELIGIBILITY_DIAGNOSTIC_USER_ID ||
    auth.user.id !==
      process.env.OXYGEN_PRODUCTION_ELIGIBILITY_DIAGNOSTIC_USER_ID
  )
    return unavailable();
  try {
    // The operator-wide limit is checked before any workflow or evidence lookup.
    if (
      !(
        await checkOxygenProviderRateLimit(
          auth.user.id,
          'eligibility-evidence',
          6
        )
      ).allowed
    )
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers }
      );
  } catch {
    return unavailable();
  }
  const input = oxygenEligibilityEvidenceQuery.safeParse({
    workflowId: request.nextUrl.searchParams.get('workflowId'),
    commandId: request.nextUrl.searchParams.get('commandId'),
  });
  if (!input.success) return unavailable();
  try {
    const snapshot = await readOxygenSnapshot(
      auth.supabase,
      input.data.workflowId
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
      input.data.workflowId,
      input.data.commandId,
      config.evidenceKey
    );
    const responses: {
      httpStatus: number;
      capture: string;
      body?: string;
      bodyBase64?: string;
    }[] = [];
    for (const entry of evidence) {
      const parsed = oxygenEligibilityEvidenceRecord.safeParse(entry);
      if (!parsed.success) continue;
      const raw = parsed.data.eligibilityRaw;
      if (raw.capture !== 'complete') {
        responses.push({
          httpStatus: parsed.data.httpStatus,
          capture: raw.capture,
        });
        continue;
      }
      const bytes = Buffer.from(raw.bodyBase64, 'base64');
      if (bytes.toString('base64') !== raw.bodyBase64) continue;
      try {
        responses.push({
          httpStatus: parsed.data.httpStatus,
          capture: 'complete',
          body: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        });
      } catch {
        responses.push({
          httpStatus: parsed.data.httpStatus,
          capture: 'complete',
          bodyBase64: raw.bodyBase64,
        });
      }
    }
    return responses.length
      ? NextResponse.json({ responses }, { headers })
      : unavailable();
  } catch {
    return unavailable();
  }
}
