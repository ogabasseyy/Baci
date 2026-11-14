import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createExperienceToolDispatcher } from '../../src/lib/experience/tool-dispatcher';
import { createExperienceGateway } from '../../src/lib/experience/tool-gateway';
import { experiencePerformanceReport } from '../../src/schemas/experience-performance';
import { lifecycleDataClient } from '../experience-lifecycle/data-client.test-support';
import { lifecycleFixture } from '../experience-lifecycle/sql.test-support';

const root = new URL(
  '../../../../.superpowers/sdd/2026-10-25-experience-cwv/artifacts/',
  import.meta.url
);
it('returns the actual retained browser report through owner-authenticated MCP and normal RLS without publishing', async () => {
  const report = experiencePerformanceReport.parse(
    JSON.parse(readFileSync(new URL('lab-prerender-report.json', root), 'utf8'))
      .report
  );
  const f = await lifecycleFixture();
  const data = await lifecycleDataClient(f);
  try {
    // Disposable setup only. This report is diagnostic and cannot authorize publication.
    const build = await f.build('measured-performance');
    await f.pool.query(
      'UPDATE experience_builds SET build_digest=$1 WHERE id=$2',
      [report.buildDigest, build.id]
    );
    await f.pool.query(
      'UPDATE experience_jobs SET source_digest=$1 WHERE artifact_id=$2',
      [report.sourceDigest, build.artifact]
    );
    await f.pool.query(
      'UPDATE experience_artifacts SET source_digest=$1 WHERE id=$2',
      [report.sourceDigest, build.artifact]
    );
    const read = vi.fn(
      async (binding: { buildDigest: string; sourceDigest: string }) => {
        if (
          binding.buildDigest !== report.buildDigest ||
          binding.sourceDigest !== report.sourceDigest
        )
          return undefined;
        return structuredClone(report);
      }
    );
    const forbidden = vi.fn(async () => {
      throw Error('MUTATION_FORBIDDEN');
    });
    const identity = {
      actorUserId: f.actor,
      connectionId: f.connection,
      grantVersion: 1,
      allowedMerchantIds: [f.merchantId],
      scopes: new Set(['storefront.read'] as const),
      allowCreateStore: false,
    };
    const gateway = createExperienceGateway({
      authenticate: async () => identity,
      execute: createExperienceToolDispatcher({
        resolveUserClient: async () => data.client,
        finalizeBuild: forbidden,
        preview: forbidden,
        readPerformance: read,
      }),
    });
    const response = await gateway(
      new Request(
        'http://127.0.0.1/api/builder-gateway/read_experience_performance',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer local.synthetic',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            storefrontId: f.merchantId,
            buildId: build.id,
          }),
        }
      ),
      'read_experience_performance'
    );
    const result = await response.json();
    expect(result).toEqual({
      status: 'ok',
      value: { buildId: build.id, status: 'lab-only', report },
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('0');
  } finally {
    await data.close();
    await f.close();
  }
});
