import { afterEach, expect, it, vi } from 'vitest';
import { createLocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import type { ExperienceContext } from './authorization';
import {
  bindBuildExecutor,
  resolveBuildHost,
  startLinkedBuildLease,
} from './build-execution';
import type { ExperienceBuildDependencies } from './local-build-supervisor-types';

const hostOrigin = 'https://shop.synthetic.test';
const localOrigin = 'http://127.0.0.1:43000';

function fixture() {
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const owner = {
    supabase: { rpc },
    merchantId: 'synthetic-merchant',
    actorUserId: 'synthetic-owner',
  } as unknown as ExperienceContext;
  const linked: ExperienceContext = {
    ...owner,
    identity: {
      connectionId: 'synthetic-connection',
      grantVersion: 3,
      actorUserId: owner.actorUserId,
      scopes: new Set(['storefront.write']),
      allowedMerchantIds: [owner.merchantId],
      allowCreateStore: false,
    },
  };
  const run = vi.fn(async () => ({
    jobId: 'synthetic-job',
    output: 'synthetic',
    wallMs: 1,
  }));
  const production: ExperienceBuildDependencies = {
    profile: 'production',
    key: new Uint8Array(32),
    toolchainDigest: 'a'.repeat(64),
    hostOrigin,
    execute: run,
    transient: createTransientOutputStore(),
    prerenderArtifacts: createLocalPrerenderArtifacts(),
    bootstrap: async () => {
      throw Error('Unexpected bootstrap invocation');
    },
    recordVerifiedEvidence: vi.fn(async () => {}),
  };
  return { owner, linked, run, production, rpc };
}

afterEach(() => vi.useRealTimers());

it('admits a loopback local origin and a linked, fully configured HTTPS production host', () => {
  const { owner, linked, production } = fixture();
  const local = { ...production, profile: undefined, hostOrigin: localOrigin };
  expect(resolveBuildHost(owner, local)).toBe(localOrigin);
  expect(() => resolveBuildHost(owner, { ...local, hostOrigin })).toThrow();
  expect(() =>
    resolveBuildHost(owner, { ...local, previewOrigin: hostOrigin })
  ).toThrow('INVALID_PREVIEW_ORIGIN');
  expect(resolveBuildHost(linked, production)).toBe(hostOrigin);
  expect(() => resolveBuildHost(owner, production)).toThrow(
    'BUILD_CONNECTION_REQUIRED'
  );
  expect(() =>
    resolveBuildHost(linked, { ...production, hostOrigin: localOrigin })
  ).toThrow('INVALID_PRODUCTION_ORIGIN');
  expect(() =>
    resolveBuildHost(linked, { ...production, execute: undefined })
  ).toThrow('INCOMPLETE_PRODUCTION_BUILD');
});

it('passes the abort signal to the executor and drops a response returned after cancellation', async () => {
  const { run } = fixture();
  const controller = new AbortController();
  const failure = Error('synthetic disconnect');
  const withSignal = vi.fn(async () => {
    controller.abort(failure);
    return { jobId: 'synthetic-job', output: 'late', wallMs: 1 };
  });
  const execute = bindBuildExecutor(
    Object.assign(run, { withSignal }),
    controller.signal
  );
  await expect(execute('compile', {})).rejects.toBe(failure);
  expect(withSignal).toHaveBeenCalledExactlyOnceWith(
    'compile',
    {},
    controller.signal
  );
  await expect(execute('compile', {})).rejects.toBe(failure);
  expect(withSignal).toHaveBeenCalledOnce();
  expect(run).not.toHaveBeenCalled();
});

it('renews the exact linked build attempt and stops on disconnect', async () => {
  vi.useFakeTimers();
  const { owner, linked, rpc } = fixture();
  const job = { id: 'synthetic-job', attempt_nonce: 'synthetic-attempt' };
  expect(startLinkedBuildLease(owner, job)).toBeUndefined();
  const controller = new AbortController();
  const lease = startLinkedBuildLease(
    { ...linked, signal: controller.signal },
    job
  );
  if (!lease) throw Error('Missing linked lease');

  try {
    await vi.advanceTimersByTimeAsync(120000);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'experience_renew_build_lease',
      {
        p_merchant: linked.merchantId,
        p_connection: 'synthetic-connection',
        p_version: 3,
        p_job: job.id,
        p_attempt: job.attempt_nonce,
      }
    );
    controller.abort();
    await vi.advanceTimersByTimeAsync(120000);
    expect(rpc).toHaveBeenCalledOnce();
    await expect(lease.assertHeld()).rejects.toThrow('BUILD_LEASE_LOST');
  } finally {
    await lease.stop();
  }
});
