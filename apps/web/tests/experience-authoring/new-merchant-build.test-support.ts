import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { z } from 'zod';
import { digestBytes } from '@/lib/experience/manifest-digest';
import type { NewMerchantMcpCall } from './new-merchant-mcp.test-support';
import type { setupNewMerchantRunner } from './new-merchant-runner.test-support';
import { SYNTHETIC_BUILD_POLL_TIMEOUT_MS } from './synthetic-build-deadline.test-support';
import { syntheticInteractiveSource } from './synthetic-interactive-source.test-support';

export async function queueNewMerchantBuild(
  call: NewMerchantMcpCall,
  storefrontId: string
) {
  const nativeCheckout = process.env.BACI_LOCAL_NATIVE_CHECKOUT_TEST === '1';
  const content = nativeCheckout
    ? `export default function App({catalog}) {
        return <main><h1>New synthetic store</h1><p>{catalog.products[0]?.name}</p></main>;
      }`
    : syntheticInteractiveSource;
  const upload = await call('begin_experience_upload', {
    storefrontId,
    manifest: {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [{ path: 'app.tsx', content: '' }],
      packages: [{ name: 'react', versionRef: 'platform-pinned' }],
      routes: [{ path: '/', view: 'home' }],
      assets: [],
      capabilities: [
        'navigation',
        'catalog.read',
        ...(nativeCheckout
          ? []
          : [
              'cart.read-public',
              'cart.mutate',
              'checkout.prepare',
              'checkout.open',
            ]),
      ],
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
  });
  const uploadId = z
    .object({
      result: z.object({
        structuredContent: z.object({
          status: z.literal('ok'),
          value: z.object({ uploadId: z.uuid() }),
        }),
      }),
    })
    .parse(upload).result.structuredContent.value.uploadId;
  expect(
    await call('write_experience_chunk', {
      storefrontId,
      uploadId,
      path: 'app.tsx',
      offset: 0,
      bytesBase64: Buffer.from(content).toString('base64'),
      chunkDigest: digestBytes(content),
    })
  ).toMatchObject({ result: { structuredContent: { status: 'ok' } } });
  const finished = await call('finalize_experience_upload', {
    storefrontId,
    uploadId,
  });
  expect(finished, JSON.stringify(finished)).toMatchObject({
    result: { structuredContent: { status: 'ok' } },
  });
  const artifactId = z
    .object({
      result: z.object({
        structuredContent: z.object({
          status: z.literal('ok'),
          value: z.object({ artifactId: z.uuid() }),
        }),
      }),
    })
    .parse(finished).result.structuredContent.value.artifactId;
  const queued = await call('build_experience', {
    storefrontId,
    artifactId,
    idempotencyKey: randomUUID(),
  });
  const jobId = z
    .object({
      result: z.object({
        structuredContent: z.object({
          status: z.literal('ok'),
          value: z.object({ jobId: z.uuid() }),
        }),
      }),
    })
    .parse(queued).result.structuredContent.value.jobId;
  return jobId;
}

export async function finalizeNewMerchantBuild(
  call: NewMerchantMcpCall,
  storefrontId: string,
  jobId: string,
  runner: Awaited<ReturnType<typeof setupNewMerchantRunner>>,
  background: boolean
) {
  process.stderr.write('SYNTHETIC_STAGE build_start\n');
  let finalized = await call('finalize_experience_build', {
    storefrontId,
    jobId,
    idempotencyKey: randomUUID(),
  });
  if (background) {
    expect(finalized).toMatchObject({
      result: { structuredContent: { status: 'ok', value: { id: jobId } } },
    });
    const deadline = Date.now() + SYNTHETIC_BUILD_POLL_TIMEOUT_MS;
    let completed = false;
    let previousStatus: string | undefined;
    while (Date.now() < deadline) {
      const status = await call('get_experience_operation', {
        storefrontId,
        jobId,
      });
      const value = status?.result?.structuredContent?.value;
      if (value?.status && value.status !== previousStatus) {
        previousStatus = value.status;
        process.stderr.write(`SYNTHETIC_JOB ${value.status}\n`);
      }
      if (value?.status === 'finalized') {
        finalized = status;
        completed = true;
        break;
      }
      if (value?.status === 'failed' || value?.status === 'cancelled') {
        const calls = await Promise.allSettled(
          runner.execute.mock.results.map((result) => result.value)
        );
        const stages = runner.execute.mock.calls.map(([kind], i) => {
          const result = calls[i];
          const reason =
            result?.status === 'rejected'
              ? `:${result.reason instanceof Error ? result.reason.name : 'UNKNOWN_ERROR'}`
              : '';
          return `${kind}:${result?.status ?? 'unknown'}${reason}`;
        });
        throw Error(`SYNTHETIC_BUILD_${value.status}:${stages.join(',')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (!completed) throw Error('SYNTHETIC_BUILD_POLL_TIMEOUT');
  }
  return finalized;
}
