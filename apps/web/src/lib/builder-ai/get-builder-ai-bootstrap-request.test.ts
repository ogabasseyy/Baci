import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getBuilderAiBootstrapRequest } from './get-builder-ai-bootstrap-request';

const token = 'a'.repeat(32);
const now = Date.parse('2026-08-05T12:00:00.000Z');
const environment = {
  BUILDER_AI_ATTEST_SMOKE_COMMIT_SHA: 'commit-sha',
  BUILDER_AI_ATTEST_SMOKE_ENABLED: '1',
  BUILDER_AI_ATTEST_SMOKE_EXPIRES_AT: '2026-08-05T12:10:00.000Z',
  BUILDER_AI_ATTEST_SMOKE_HOST: 'usebaci.com',
  BUILDER_AI_ATTEST_SMOKE_PHASE: 'attest',
  BUILDER_AI_ATTEST_SMOKE_PROJECT_ID: 'project-id',
  BUILDER_AI_ATTEST_SMOKE_RUN_ID: '11111111-1111-4111-8111-111111111111',
  BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256: createHash('sha256')
    .update(token)
    .digest('hex'),
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: 'commit-sha',
  VERCEL_PROJECT_ID: 'project-id',
};

function request(
  body = { runId: environment.BUILDER_AI_ATTEST_SMOKE_RUN_ID },
  value = token
) {
  return new Request(
    'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
    {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        host: 'usebaci.com',
        'x-baci-builder-bootstrap': value,
      },
      method: 'POST',
    }
  );
}

describe('getBuilderAiBootstrapRequest', () => {
  it('accepts only the fixed production deployment and matching token', async () => {
    await expect(
      getBuilderAiBootstrapRequest(request(), environment, now)
    ).resolves.toEqual({
      phase: 'attest',
      runId: environment.BUILDER_AI_ATTEST_SMOKE_RUN_ID,
    });
  });

  it.each([
    ['disabled', { BUILDER_AI_ATTEST_SMOKE_ENABLED: '0' }],
    ['wrong host', { BUILDER_AI_ATTEST_SMOKE_HOST: 'other.usebaci.com' }],
    ['wrong SHA', { VERCEL_GIT_COMMIT_SHA: 'other-sha' }],
    ['wrong project', { VERCEL_PROJECT_ID: 'other-project' }],
    ['non-production Vercel environment', { VERCEL_ENV: 'preview' }],
    [
      'expired',
      { BUILDER_AI_ATTEST_SMOKE_EXPIRES_AT: '2026-08-05T11:59:00.000Z' },
    ],
  ])('rejects %s controls', async (_name, changes) => {
    await expect(
      getBuilderAiBootstrapRequest(
        request(),
        { ...environment, ...changes },
        now
      )
    ).resolves.toBeNull();
  });

  it('rejects a mismatched token or run id', async () => {
    await expect(
      getBuilderAiBootstrapRequest(
        request(undefined, 'b'.repeat(32)),
        environment,
        now
      )
    ).resolves.toBeNull();
    await expect(
      getBuilderAiBootstrapRequest(
        request({ runId: '22222222-2222-4222-8222-222222222222' }),
        environment,
        now
      )
    ).resolves.toBeNull();
  });

  it('requires the bounded payload to contain only the expected run id', async () => {
    await expect(
      getBuilderAiBootstrapRequest(
        request({
          ignored: 'value',
          runId: environment.BUILDER_AI_ATTEST_SMOKE_RUN_ID,
        } as never),
        environment,
        now
      )
    ).resolves.toBeNull();
  });

  it('rejects an oversized JSON body before parsing a bootstrap run id', async () => {
    const oversized = new Request(
      'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
      {
        body: JSON.stringify({
          ignored: 'x'.repeat(1024),
          runId: environment.BUILDER_AI_ATTEST_SMOKE_RUN_ID,
        }),
        headers: {
          'content-type': 'application/json',
          host: 'usebaci.com',
          'x-baci-builder-bootstrap': token,
        },
        method: 'POST',
      }
    );

    await expect(
      getBuilderAiBootstrapRequest(oversized, environment, now)
    ).resolves.toBeNull();
  });
});
