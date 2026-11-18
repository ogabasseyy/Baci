import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { expect } from 'vitest';
import { z } from 'zod';
import { confirmDraftApply } from '@/lib/experience/approval-service';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import type { startProductionBuilderStack } from '@/lib/experience/production-builder-stack';
import type { QualificationKind } from '../../tools/experience-runner/local-oci-executor';
import type { experienceDataFixture } from './data-fixture.test-support';

export function readDelivery(port: number, path: string, host: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, headers: { host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.once('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
        res.once('error', reject);
      }
    );
    req.once('error', reject);
    req.end();
  });
}

export async function checkProductionStackJourney({
  call,
  f,
  stack,
  deliveryPort,
  useLocalRunner,
  runnerKinds,
  countBootstraps,
}: {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  f: Awaited<ReturnType<typeof experienceDataFixture>>;
  stack: Awaited<ReturnType<typeof startProductionBuilderStack>>;
  deliveryPort: number;
  useLocalRunner: boolean;
  runnerKinds(): QualificationKind[];
  countBootstraps(): number;
}) {
  const store = { storefrontId: f.merchantId };
  expect(await call('get_experience_capabilities', store)).toMatchObject({
    result: {
      structuredContent: {
        status: 'ok',
        value: { mode: 'full-custom-code', aiProviderCalls: 0 },
      },
    },
  });
  const content =
    'export default function App(){return <h1>Synthetic production stack</h1>}';
  const readId = (
    key:
      | 'uploadId'
      | 'artifactId'
      | 'jobId'
      | 'buildId'
      | 'evidenceId'
      | 'approvalId',
    value: unknown
  ) =>
    z
      .object({
        result: z.object({
          structuredContent: z.object({
            status: z.literal('ok'),
            value: z.record(z.string(), z.unknown()),
          }),
        }),
      })
      .parse(value).result.structuredContent.value[key];
  const uploadId = z.uuid().parse(
    readId(
      'uploadId',
      await call('begin_experience_upload', {
        ...store,
        manifest: {
          format: 'baci.experience/v2',
          runtime: 'react-browser-sandbox/v1',
          sdkVersion: 'commerce-bridge/v1',
          entry: 'app.tsx',
          files: [{ path: 'app.tsx', content: '' }],
          packages: [],
          routes: [{ path: '/', view: 'home' }],
          assets: [],
          capabilities: ['navigation', 'catalog.read'],
        },
        files: {
          files: [
            {
              path: 'app.tsx',
              bytes: Buffer.byteLength(content),
              digest: digestBytes(content),
            },
          ],
        },
      })
    )
  );
  expect(
    await call('write_experience_chunk', {
      ...store,
      uploadId,
      path: 'app.tsx',
      offset: 0,
      bytesBase64: Buffer.from(content).toString('base64'),
      chunkDigest: digestBytes(content),
    })
  ).toMatchObject({ result: { structuredContent: { status: 'ok' } } });
  const artifactId = z
    .uuid()
    .parse(
      readId(
        'artifactId',
        await call('finalize_experience_upload', { ...store, uploadId })
      )
    );
  const jobId = z.uuid().parse(
    readId(
      'jobId',
      await call('build_experience', {
        ...store,
        artifactId,
        idempotencyKey: randomUUID(),
      })
    )
  );
  expect(
    await call('get_experience_operation', { ...store, jobId })
  ).toMatchObject({ result: { structuredContent: { status: 'ok' } } });
  const finalized = await call('finalize_experience_build', {
    ...store,
    jobId,
    idempotencyKey: randomUUID(),
  });
  expect(finalized).toMatchObject(
    useLocalRunner
      ? {
          result: {
            structuredContent: {
              status: 'ok',
              value: {
                performance: {
                  status: 'not-measured',
                  releaseQualified: false,
                },
              },
            },
          },
        }
      : {
          result: {
            structuredContent: { status: 'error', code: 'UNAVAILABLE' },
          },
        }
  );
  const kinds = runnerKinds();
  let deliveredUrl: string | undefined;
  if (useLocalRunner) {
    expect(kinds.slice(0, 3)).toEqual([
      'prerender-build',
      'prerender-build',
      'prerender',
    ]);
    expect(
      kinds.filter((kind) => kind === 'capture').length
    ).toBeGreaterThanOrEqual(24);
    expect(kinds).not.toContain('performance');
  } else expect(kinds).toEqual(['prerender-build']);
  expect(countBootstraps()).toBe(useLocalRunner ? 2 : 1);
  expect(
    await call('get_experience_operation', { ...store, jobId })
  ).toMatchObject({
    result: {
      structuredContent: {
        status: 'ok',
        value: { id: jobId, status: useLocalRunner ? 'finalized' : 'failed' },
      },
    },
  });
  if (useLocalRunner) {
    const buildId = z.uuid().parse(readId('buildId', finalized));
    const preview = await call('preview_experience', {
      ...store,
      buildId,
      routeId: 'home',
      idempotencyKey: randomUUID(),
    });
    const evidenceId = z.uuid().parse(readId('evidenceId', preview));
    expect(preview).toMatchObject({
      result: {
        structuredContent: {
          status: 'ok',
          value: {
            buildId,
            performance: { qualification: { status: 'not-measured' } },
          },
        },
      },
    });
    const approval = await call('apply_experience', {
      ...store,
      buildId,
      evidenceId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    });
    const approvalId = z.uuid().parse(readId('approvalId', approval));
    expect(approval).toMatchObject({
      result: {
        structuredContent: {
          status: 'ok',
          value: { status: 'confirmation-required' },
        },
      },
    });
    await expect(
      confirmDraftApply(f.owner.supabase, approvalId)
    ).rejects.toThrow('CONFIRMATION_UNAVAILABLE');
    const ownerRuntime = getExperienceOwnerRuntime();
    if (!ownerRuntime) throw Error('OWNER_RUNTIME_MISSING');
    const launch = z
      .object({ src: z.url(), renderMode: z.literal('prerender') })
      .parse(
        await ownerRuntime.createPreviewLaunch(
          { ...f.owner, requestOrigin: 'https://builder.synthetic.test' },
          { buildId, routeId: 'home' }
        )
      );
    const url = new URL(launch.src);
    expect(url.origin).toBe('https://output.synthetic-output.test');
    const direct = await stack.deliver(new Request(launch.src));
    if (direct.status !== 200)
      throw Error(`DIRECT_PREVIEW_${direct.status}_${await direct.text()}`);
    deliveredUrl = `http://127.0.0.1:${deliveryPort}${url.pathname}${url.search}`;
    const delivered = await readDelivery(
      deliveryPort,
      `${url.pathname}${url.search}`,
      url.host
    );
    if (delivered.status !== 200)
      throw Error(`LISTENER_PREVIEW_${delivered.status}_${delivered.body}`);
    expect(delivered.status).toBe(200);
    expect(delivered.body).toContain('Synthetic production stack');
  }
  return { store, deliveredUrl };
}
