import { createHash, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OwnerRequestContext } from '../../src/lib/experience/authorization';
import { createBackgroundBuildWorker } from '../../src/lib/experience/background-build-worker';
import { experienceDataFixture } from './data-fixture.test-support';

it('recovers a stale user-scoped job and fences the old worker', async () => {
  const f = await experienceDataFixture({ tokenTtlSeconds: 900 });
  let firstTick = () => {};
  let secondTick = () => {};
  let releaseFirst = () => {};
  let releaseSecond = () => {};
  let claimedFirst = () => {};
  let claimedSecond = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const firstClaim = new Promise<void>((resolve) => {
    claimedFirst = resolve;
  });
  const secondClaim = new Promise<void>((resolve) => {
    claimedSecond = resolve;
  });
  let first: ReturnType<typeof createBackgroundBuildWorker> | undefined;
  let second: ReturnType<typeof createBackgroundBuildWorker> | undefined;
  try {
    const artifact = randomUUID();
    await f.db.pool.query(
      "INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,repeat('a',64),'{}')",
      [artifact, f.merchantId]
    );
    const queued = await f.owner.supabase.rpc('experience_queue_build', {
      p_merchant: f.merchantId,
      p_connection: f.connectionId,
      p_version: 1,
      p_artifact: artifact,
      p_retry: randomUUID(),
    });
    expect(queued.error).toBeNull();
    const jobId = queued.data as string;
    const shared = {
      listConnections: async () => [f.connectionId],
      readConnection: f.db.storage.readConnection,
      resolveLinkedAccessToken: async () => f.owner.accessToken,
      resolveUser: async () => ({
        actorUserId: f.actorId,
        client: f.owner.supabase,
      }),
      resolveUserClient: async () => f.owner.supabase,
    };
    const run =
      (gate: Promise<void>, notify: () => void) =>
      async (ctx: OwnerRequestContext) => {
        const row = await ctx.supabase
          .from('experience_jobs')
          .select('attempt_nonce')
          .eq('id', jobId)
          .eq('merchant_id', f.merchantId)
          .single();
        if (row.error || !row.data) throw Error('SYNTHETIC_JOB_MISSING');
        const args = {
          p_merchant: f.merchantId,
          p_connection: f.connectionId,
          p_version: 1,
          p_job: jobId,
          p_attempt: row.data.attempt_nonce,
        };
        const claim = await ctx.supabase.rpc('experience_claim_build', args);
        if (claim.error) throw Error('SYNTHETIC_CLAIM_FAILED');
        notify();
        await gate;
        const result = await ctx.supabase.rpc('experience_fail_build', args);
        if (result.error) throw Error('SYNTHETIC_FAIL_FAILED');
        return { buildId: randomUUID(), buildDigest: 'a'.repeat(64) };
      };
    first = createBackgroundBuildWorker({
      ...shared,
      finalizeBuild: run(firstGate, claimedFirst),
      schedule: (tick) => {
        firstTick = tick;
        return () => {};
      },
    });
    second = createBackgroundBuildWorker({
      ...shared,
      finalizeBuild: run(secondGate, claimedSecond),
      schedule: (tick) => {
        secondTick = tick;
        return () => {};
      },
    });
    firstTick();
    await Promise.race([
      firstClaim,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('FIRST_CLAIM_TIMEOUT')), 15000)
      ),
    ]);
    await f.db.pool.query(
      "UPDATE experience_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [jobId]
    );
    secondTick();
    await Promise.race([
      secondClaim,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('SECOND_CLAIM_TIMEOUT')), 15000)
      ),
    ]);
    releaseFirst();
    await first.close();
    expect(
      (
        await f.db.pool.query(
          'SELECT status,background_recoveries FROM experience_jobs WHERE id=$1',
          [jobId]
        )
      ).rows
    ).toEqual([{ status: 'running', background_recoveries: 1 }]);
    releaseSecond();
    await second.close();
    expect(
      (
        await f.db.pool.query(
          'SELECT status FROM experience_jobs WHERE id=$1',
          [jobId]
        )
      ).rows[0].status
    ).toBe('failed');
  } finally {
    releaseFirst();
    releaseSecond();
    await first?.close();
    await second?.close();
    await f.close();
  }
}, 60000);

it('reconciles a lost finalize response for the same linked job under RLS', async () => {
  const f = await experienceDataFixture({ tokenTtlSeconds: 900 });
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  try {
    const artifact = randomUUID();
    const source = hash('synthetic-source');
    await f.db.pool.query(
      "INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,'{}')",
      [artifact, f.merchantId, source]
    );
    const queued = await f.owner.supabase.rpc('experience_queue_build', {
      p_merchant: f.merchantId,
      p_connection: f.connectionId,
      p_version: 1,
      p_artifact: artifact,
      p_retry: randomUUID(),
    });
    expect(queued.error).toBeNull();
    const job = queued.data as string;
    const row = await f.owner.supabase
      .from('experience_jobs')
      .select('attempt_nonce')
      .eq('id', job)
      .single();
    expect(row.error).toBeNull();
    const attempt = row.data?.attempt_nonce;
    const binding = {
      p_merchant: f.merchantId,
      p_connection: f.connectionId,
      p_version: 1,
      p_job: job,
      p_attempt: attempt,
    };
    expect(
      (await f.owner.supabase.rpc('experience_claim_build', binding)).error
    ).toBeNull();
    const javascript = 'export{}';
    const build = hash(`${javascript}\0`);
    const receipt = hash('synthetic-receipt');
    const origin = 'https://merchant.synthetic.test';
    const verifier = await f.db.pool.connect();
    try {
      await verifier.query('BEGIN');
      await verifier.query('SET LOCAL ROLE baci_experience_verifier');
      await verifier.query(
        'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
        [f.merchantId, job, attempt, build, receipt, origin]
      );
      await verifier.query('COMMIT');
    } finally {
      verifier.release();
    }
    const args = {
      ...binding,
      p_source: source,
      p_build: build,
      p_receipt: receipt,
      p_retry: job,
      p_host_origin: origin,
      p_files: [
        {
          path: 'app.js',
          mime: 'text/javascript',
          bytes: Buffer.from(javascript).toString('hex'),
          digest: hash(javascript),
        },
        { path: 'app.css', mime: 'text/css', bytes: '', digest: hash('') },
      ],
    };
    const committed = await f.owner.supabase.rpc(
      'experience_finalize_build',
      args
    );
    expect(committed.error).toBeNull();
    // Treat the successful response as lost: reconcile through the owner's job read.
    const status = await f.owner.supabase
      .from('experience_jobs')
      .select('status')
      .eq('id', job)
      .single();
    expect(status.data?.status).toBe('finalized');
    const replay = await f.owner.supabase.rpc(
      'experience_finalize_build',
      args
    );
    expect(replay.error).toBeNull();
    expect(replay.data).toBe(committed.data);
    const foreignReplay = await f.other.supabase.rpc(
      'experience_finalize_build',
      args
    );
    expect(foreignReplay.error).not.toBeNull();
    expect(foreignReplay.data).toBeNull();
    const conflict = await f.owner.supabase.rpc('experience_finalize_build', {
      ...args,
      p_receipt: hash('other'),
    });
    expect(conflict.error?.message).toContain('IDEMPOTENCY_CONFLICT');
  } finally {
    await f.close();
  }
}, 60000);
