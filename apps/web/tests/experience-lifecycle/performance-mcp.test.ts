import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createExperienceToolDispatcher } from '@/lib/experience/tool-dispatcher';
import { createExperienceGateway } from '@/lib/experience/tool-gateway';
import { lifecycleDataClient } from './data-client.test-support';
import { hash, lifecycleFixture } from './sql.test-support';

it('reads retained diagnostics over MCP HTTP under normal owner RLS and denies a revoked grant without publication', async () => {
  const f = await lifecycleFixture();
  const data = await lifecycleDataClient(f);
  try {
    const build = await f.build('performance-synthetic');
    await f.pool.query(
      'UPDATE experience_artifacts SET manifest=$2 WHERE id=$1',
      [
        build.artifact,
        {
          format: 'baci.experience/v2',
          runtime: 'react-browser-sandbox/v1',
          sdkVersion: 'commerce-bridge/v1',
          entry: 'Experience.tsx',
          files: [
            { path: 'Experience.tsx', content: 'export default () => null' },
          ],
          packages: [],
          routes: [{ path: '/', view: 'home' }],
          assets: [],
          capabilities: [],
        },
      ]
    );
    const read = vi.fn(async () => ({
      format: 'baci.performance-lab/v1',
      buildDigest: build.digest,
      sourceDigest: hash('performance-synthetic'),
      measuredAt: '2026-10-25T18:00:00.000Z',
      renderer: 'prerender',
      environment: 'local-synthetic',
      cwvQualified: false,
      releaseQualified: false,
      contaminated: true,
      browser: 'Synthetic contract fixture',
      bootstrapDigests: [{ route: '/', digest: hash('performance-bootstrap') }],
      samples: [
        {
          width: 390,
          cache: 'cold-context',
          route: '/',
          frameLcpMs: null,
          hostLcpMs: null,
          frameCls: null,
          hostCls: null,
          diagnostics: {
            host: {
              rawCls: 0,
              firstPaintMs: null,
              rawLayoutShifts: [],
              layoutShiftOverflow: false,
            },
            frame: {
              rawCls: 0,
              firstPaintMs: null,
              rawLayoutShifts: [],
              layoutShiftOverflow: false,
            },
          },
          interactionDurationMs: null,
          contentVisible: false,
          imagesDecoded: false,
          consoleErrors: 0,
        },
      ],
    }));
    const identity = {
      actorUserId: f.actor,
      connectionId: f.connection,
      grantVersion: 1,
      allowedMerchantIds: [f.merchantId],
      scopes: new Set(['storefront.read'] as const),
      allowCreateStore: false,
    };
    const forbidden = vi.fn(async () => {
      throw Error('MUTATION_FORBIDDEN');
    });
    const gateway = createExperienceGateway({
      authenticate: async () => identity,
      execute: createExperienceToolDispatcher({
        resolveUserClient: async () => data.client,
        finalizeBuild: forbidden,
        preview: forbidden,
        readPerformance: read,
      }),
    });
    const call = async (
      buildId: string,
      extra: Record<string, unknown> = {}
    ) => {
      const response = await gateway(
        new Request(
          'http://127.0.0.1/api/builder-gateway/read_experience_performance',
          {
            method: 'POST',
            headers: {
              authorization: 'Bearer synthetic.token',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              storefrontId: f.merchantId,
              buildId,
              ...extra,
            }),
          }
        ),
        'read_experience_performance'
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
      return response.json();
    };
    expect(await call(build.id)).toMatchObject({
      status: 'ok',
      value: {
        status: 'lab-only',
        report: { cwvQualified: false, contaminated: true },
      },
    });
    expect(await call(randomUUID())).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(await call(build.id, { url: 'https://example.com' })).toMatchObject({
      status: 'error',
      code: 'INVALID_REQUEST',
    });
    await f.run('disconnect_builder_connection', [f.connection]);
    expect(await call(build.id)).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
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
