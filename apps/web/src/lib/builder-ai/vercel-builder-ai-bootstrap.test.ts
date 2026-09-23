import { describe, expect, it, vi } from 'vitest';
import {
  builderAiBootstrapComment,
  createBuilderAiVercelBootstrapClient,
} from './vercel-builder-ai-bootstrap';

const environment = {
  VERCEL_API_TOKEN: 'secret',
  VERCEL_PROJECT_ID: 'project',
  VERCEL_TEAM_ID: 'team',
};
const runId = '11111111-1111-4111-8111-111111111111';

describe('createBuilderAiVercelBootstrapClient', () => {
  it('uses VERCEL_ORG_ID when an explicit team id is absent', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            envs: [
              {
                comment: builderAiBootstrapComment(runId),
                id: 'row',
                key: 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256',
                target: ['production'],
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createBuilderAiVercelBootstrapClient(
      {
        VERCEL_API_TOKEN: 'secret',
        VERCEL_ORG_ID: 'org',
        VERCEL_PROJECT_ID: 'project',
      },
      fetcher
    );

    expect(client).not.toBeNull();
    if (!client) throw new Error('Expected a Vercel bootstrap client');
    await expect(client.claimToken(runId)).resolves.toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.vercel.com/v10/projects/project/env?teamId=org',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('claims only one token metadata row using fixed Vercel URLs', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            envs: [
              {
                id: 'row',
                key: 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256',
                comment: builderAiBootstrapComment(runId),
                target: ['production'],
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);
    await expect(client?.claimToken(runId)).resolves.toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.vercel.com/v10/projects/project/env?teamId=team',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.vercel.com/v9/projects/project/env/row?teamId=team',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('rejects an ambiguous claim without deleting a row', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ envs: [] }), { status: 200 })
      );
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);
    await expect(client?.claimToken(runId)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('claims a matching token row from a later Vercel environment page', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            envs: [],
            pagination: { next: 1710000100000 },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            envs: [
              {
                id: 'later-row',
                key: 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256',
                comment: builderAiBootstrapComment(runId),
                target: ['production'],
              },
            ],
            pagination: { next: null },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(client?.claimToken(runId)).resolves.toBe(true);

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.vercel.com/v10/projects/project/env?until=1710000100000&teamId=team',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'https://api.vercel.com/v9/projects/project/env/later-row?teamId=team',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('does not claim a matching hash row outside production', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          envs: [
            {
              id: 'preview-row',
              key: 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256',
              comment: builderAiBootstrapComment(runId),
              target: ['preview'],
            },
          ],
        }),
        { status: 200 }
      )
    );
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(client?.claimToken(runId)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not claim a mixed production and preview token row', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          envs: [
            {
              id: 'mixed-row',
              key: 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256',
              comment: builderAiBootstrapComment(runId),
              target: ['production', 'preview'],
            },
          ],
        }),
        { status: 200 }
      )
    );
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(client?.claimToken(runId)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('treats a failed token deletion as an unclaimed bootstrap', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            envs: [
              {
                id: 'row',
                key: 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256',
                comment: builderAiBootstrapComment(runId),
                target: ['production'],
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(client?.claimToken(runId)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cannot let an old run delete a newly armed token row', async () => {
    const nextRunId = '22222222-2222-4222-8222-222222222222';
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          envs: [
            {
              comment: builderAiBootstrapComment(nextRunId),
              id: 'new-row',
              key: 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256',
              target: ['production'],
            },
          ],
        }),
        { status: 200 }
      )
    );
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(client?.claimToken(runId)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not delete after a failed environment list request', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(client?.claimToken(runId)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('upserts sensitive production-only attestation values', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(
      client?.upsertAttestation({
        BUILDER_AI_PROVIDER_BINDING_PEPPER: 'pepper',
        GOOGLE_BUILDER_ACCOUNT_REF: 'account',
        GOOGLE_BUILDER_APPROVED_MODEL: 'model',
        GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG: 'tag',
        GOOGLE_BUILDER_DEPLOYMENT_TIER: 'tier',
        GOOGLE_BUILDER_RELEASE_ATTESTED_AT: 'time',
        GROQ_BUILDER_ACCOUNT_REF: 'account',
        GROQ_BUILDER_APPROVED_MODEL: 'model',
        GROQ_BUILDER_CREDENTIAL_BINDING_TAG: 'tag',
        GROQ_BUILDER_DEPLOYMENT_TIER: 'tier',
        GROQ_BUILDER_RELEASE_ATTESTED_AT: 'time',
      })
    ).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(11);
    for (const [, init] of fetcher.mock.calls) {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        target: ['production'],
        type: 'sensitive',
      });
    }
  });

  it('fails the attestation write when any control-plane upsert fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const client = createBuilderAiVercelBootstrapClient(environment, fetcher);

    await expect(
      client?.upsertAttestation({
        BUILDER_AI_PROVIDER_BINDING_PEPPER: 'pepper',
        GOOGLE_BUILDER_ACCOUNT_REF: 'account',
        GOOGLE_BUILDER_APPROVED_MODEL: 'model',
        GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG: 'tag',
        GOOGLE_BUILDER_DEPLOYMENT_TIER: 'tier',
        GOOGLE_BUILDER_RELEASE_ATTESTED_AT: 'time',
        GROQ_BUILDER_ACCOUNT_REF: 'account',
        GROQ_BUILDER_APPROVED_MODEL: 'model',
        GROQ_BUILDER_CREDENTIAL_BINDING_TAG: 'tag',
        GROQ_BUILDER_DEPLOYMENT_TIER: 'tier',
        GROQ_BUILDER_RELEASE_ATTESTED_AT: 'time',
      })
    ).resolves.toBe(false);
  });
});
