import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { hash, lifecycleFixture } from './sql.test-support';
import { runVerifierTransaction } from './verifier-transaction';

vi.mock('server-only', () => ({}));

let f: Awaited<ReturnType<typeof lifecycleFixture>>;
beforeAll(async () => {
  f = await lifecycleFixture(false, process.env.BACI_BUILDER_LOCAL_PG === '1');
  for (const name of [
    '20261111231000_experience_approval_retry_proofs.sql',
    '20261123091421_experience_resume_approval_preparation.sql',
    '20261126072000_experience_prepare_approval_max_proof.sql',
  ]) {
    await f.pool.query(
      readFileSync(
        new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
        'utf8'
      )
    );
  }
});
afterAll(async () => f?.close());

it('renews the same expired owner effect once without granting authority to apply', async () => {
  const build = await f.build('approval-renewal');
  const initial = await f.run('experience_request_draft_apply', [
    f.merchantId,
    f.connection,
    1,
    build.id,
    build.evidence,
    0,
    randomUUID(),
  ]);
  expect(
    await f.run('experience_prepare_approval', [initial.approvalId, 'draft'])
  ).toMatchObject({
    approvalId: initial.approvalId,
    effectDigest: initial.effectDigest,
  });
  await f.pool.query(
    "UPDATE experience_authorization.apply_intents SET issued_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' WHERE id = $1",
    [initial.approvalId]
  );
  const otherOwner = randomUUID();
  await f.pool.query('INSERT INTO auth.users VALUES ($1)', [otherOwner]);
  await expect(
    f.run(
      'experience_prepare_approval',
      [initial.approvalId, 'draft'],
      otherOwner
    )
  ).rejects.toThrow('NOT_FOUND');
  const renewal = await f.run('experience_prepare_approval', [
    initial.approvalId,
    'draft',
  ]);
  expect(renewal).toMatchObject({
    status: 'confirmation-required',
    effectDigest: initial.effectDigest,
  });
  expect(renewal.approvalId).not.toBe(initial.approvalId);
  expect(
    await f.run('experience_prepare_approval', [initial.approvalId, 'draft'])
  ).toEqual({ status: 'preparing', approvalId: renewal.approvalId });
  await expect(
    f.run('experience_confirm_draft_apply', [initial.approvalId])
  ).rejects.toThrow('APPROVAL_EXPIRED');
  await expect(
    f.run('experience_confirm_draft_apply', [renewal.approvalId])
  ).rejects.toThrow('PREVIEW_REQUIRED');
});

it('reuses a valid proof and renews without publishing when that proof loses its confirmation window', async () => {
  const build = await f.build('publication-approval-renewal');
  await f.apply(build, 0);
  const initial = await f.run('experience_request_lifecycle', [
    f.merchantId,
    f.connection,
    1,
    'publish',
    { buildId: build.id, expectedDraftVersion: 1, expectedPublishedVersion: 0 },
    randomUUID(),
  ]);
  await f.proof(initial.approvalId);
  expect(
    await f.run('experience_prepare_approval', [
      initial.approvalId,
      'lifecycle',
    ])
  ).toMatchObject({
    approvalId: initial.approvalId,
    proofExpiresAt: expect.any(String),
  });
  await f.pool.query(
    "UPDATE experience_authorization.lifecycle_checks SET expires_at = clock_timestamp() + interval '5 seconds' WHERE intent_id = $1",
    [initial.approvalId]
  );
  const renewal = await f.run('experience_prepare_approval', [
    initial.approvalId,
    'lifecycle',
  ]);
  expect(renewal).toMatchObject({
    status: 'confirmation-required',
    effectDigest: initial.effectDigest,
  });
  expect(renewal.approvalId).not.toBe(initial.approvalId);
  await expect(
    f.run('experience_confirm_publication', [renewal.approvalId])
  ).rejects.toThrow('PREVIEW_REQUIRED');
  expect(
    (
      await f.pool.query(
        'SELECT count(*) FROM public.experience_published_heads'
      )
    ).rows[0].count
  ).toBe('0');
});

it('reuses the latest valid draft retry proof instead of picking an earlier expired proof row', async () => {
  const build = await f.build('draft-retry-proof-max');
  const initial = await f.run('experience_request_draft_apply', [
    f.merchantId,
    f.connection,
    1,
    build.id,
    build.evidence,
    1,
    randomUUID(),
  ]);
  await runVerifierTransaction(f.c, async () => {
    await f.c.query(
      "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,verified_at,expires_at) VALUES($1,$2,$3,clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '1 second')",
      [initial.approvalId, initial.effectDigest, hash('expired-render')]
    );
  });
  await runVerifierTransaction(f.c, async () => {
    await f.c.query(
      "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,verified_at,expires_at) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '4 minutes')",
      [initial.approvalId, initial.effectDigest, hash('fresh-retry-render')]
    );
  });
  const prepared = await f.run('experience_prepare_approval', [
    initial.approvalId,
    'draft',
  ]);
  expect(prepared).toMatchObject({
    approvalId: initial.approvalId,
    status: 'confirmation-required',
    effectDigest: initial.effectDigest,
    proofExpiresAt: expect.any(String),
  });
  expect(Date.parse(prepared.proofExpiresAt)).toBeGreaterThan(
    Date.now() + 60_000
  );
});
