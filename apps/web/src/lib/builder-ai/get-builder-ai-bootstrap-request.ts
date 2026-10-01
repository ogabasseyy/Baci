import { createHash } from 'node:crypto';
import { z } from 'zod';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';

const MAX_BOOTSTRAP_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUEST_BODY_BYTES = 1024;
const tokenHeader = 'x-baci-builder-bootstrap';
const requestSchema = z.object({ runId: z.uuid() }).strict();

export type BuilderAiBootstrapPhase = 'attest' | 'verify';

export interface BuilderAiBootstrapRequest {
  phase: BuilderAiBootstrapPhase;
  runId: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

/** Returns null for every disabled or unauthenticated bootstrap request. */
export async function getBuilderAiBootstrapRequest(
  request: Request,
  environment: Environment = process.env,
  now = Date.now()
): Promise<BuilderAiBootstrapRequest | null> {
  const expectedHost = configured(environment.BUILDER_AI_ATTEST_SMOKE_HOST);
  const expectedProjectId = configured(
    environment.BUILDER_AI_ATTEST_SMOKE_PROJECT_ID
  );
  const expectedSha = configured(
    environment.BUILDER_AI_ATTEST_SMOKE_COMMIT_SHA
  );
  const phase = configured(environment.BUILDER_AI_ATTEST_SMOKE_PHASE);
  const runId = configured(environment.BUILDER_AI_ATTEST_SMOKE_RUN_ID);
  const expiresAt = Date.parse(
    environment.BUILDER_AI_ATTEST_SMOKE_EXPIRES_AT ?? ''
  );
  const expectedHash = configured(
    environment.BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256
  );
  const suppliedToken = request.headers.get(tokenHeader);
  const host = request.headers.get('host')?.trim().toLowerCase();
  const boundedBody = await readBoundedJsonBody(
    request,
    MAX_REQUEST_BODY_BYTES
  );
  if (!boundedBody.ok) return null;
  const parsedBody = requestSchema.safeParse(boundedBody.body);

  if (
    environment.VERCEL_ENV !== 'production' ||
    environment.BUILDER_AI_ATTEST_SMOKE_ENABLED !== '1' ||
    !expectedHost ||
    !expectedProjectId ||
    !expectedSha ||
    (phase !== 'attest' && phase !== 'verify') ||
    !runId ||
    !/^[a-f0-9]{64}$/.test(expectedHash ?? '') ||
    !suppliedToken ||
    Buffer.byteLength(suppliedToken, 'utf8') < 32 ||
    host !== expectedHost.toLowerCase() ||
    environment.VERCEL_PROJECT_ID !== expectedProjectId ||
    environment.VERCEL_GIT_COMMIT_SHA !== expectedSha ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MAX_BOOTSTRAP_WINDOW_MS
  ) {
    return null;
  }

  return parsedBody.success &&
    parsedBody.data.runId === runId &&
    constantTimeEqual(
      createHash('sha256').update(suppliedToken).digest('hex'),
      expectedHash as string
    )
    ? { phase, runId }
    : null;
}
