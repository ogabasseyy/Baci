import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { snapshotKeyDigest } from '@/lib/experience/snapshot-key';
import { createVerifierApprovalRecorder } from '../../tools/experience-verifier/approval-recorder';
import { createVerifierCaptureRecorder } from '../../tools/experience-verifier/capture-recorder';
import { experienceDataFixture } from './data-fixture.test-support';

vi.mock('server-only', () => ({}));

it('writes a verified capture only through the restricted verifier role', async () => {
  const f = await experienceDataFixture();
  let pool: Pool | undefined;
  try {
    if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
    await f.db.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261111231000_experience_approval_retry_proofs.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await f.db.pool.query(
      'CREATE ROLE baci_experience_verifier_login LOGIN NOINHERIT; GRANT baci_experience_verifier TO baci_experience_verifier_login'
    );
    pool = new Pool({
      host: f.db.localDatabase.socketDirectory,
      user: 'baci_experience_verifier_login',
      database: 'postgres',
      options: '-c role=baci_experience_verifier',
    });
    const artifact = randomUUID();
    const job = randomUUID();
    const build = randomUUID();
    const digest = 'a'.repeat(64);
    await f.db.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [
        artifact,
        f.merchantId,
        digest,
        { routes: [], capabilities: [], assets: [] },
      ]
    );
    await f.db.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, f.merchantId, artifact, randomUUID(), digest, randomUUID()]
    );
    await f.db.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,$4,'[]','https://shop.synthetic.test')",
      [build, f.merchantId, job, digest]
    );
    const key = {
      build: digest,
      assets: 'b'.repeat(64),
      catalog: null,
      path: '/',
    };
    const bytes = Buffer.from('synthetic screenshot');
    const capture = {
      id: randomUUID(),
      merchantId: f.merchantId,
      buildId: build,
      buildDigest: digest,
      snapshot: {
        key,
        consumesCatalog: false,
        nodes: [{ tag: 'h1' as const, children: [{ text: 'Hello' }] }],
      },
      keyDigest: snapshotKeyDigest(key),
      bytes,
      evidenceDigest: digestBytes(bytes),
    };
    const record = await createVerifierCaptureRecorder(pool);
    await expect(
      record({ ...capture, evidenceDigest: 'c'.repeat(64) })
    ).rejects.toThrow();
    await expect(
      record({ ...capture, merchantId: randomUUID() })
    ).rejects.toThrow();
    expect(
      (await f.db.pool.query('SELECT count(*) FROM experience_snapshots'))
        .rows[0].count
    ).toBe('0');
    await record(capture);
    expect(
      (await f.db.pool.query('SELECT count(*) FROM experience_snapshots'))
        .rows[0].count
    ).toBe('1');
    await expect(
      pool.query('SELECT * FROM experience_snapshots')
    ).rejects.toThrow();
    const intent = randomUUID();
    const owner = (
      await f.db.pool.query('SELECT user_id FROM merchants WHERE id=$1', [
        f.merchantId,
      ])
    ).rows[0].user_id;
    const row = await f.db.pool.query(
      "INSERT INTO experience_authorization.lifecycle_intents(id,merchant_id,actor_user_id,retry_key,action,payload,effect_digest,snapshot,expires_at) VALUES($1,$2,$3,$4,'draft-only','{}',$5,'{}',statement_timestamp()+interval '90 seconds') RETURNING expires_at",
      [intent, f.merchantId, owner, randomUUID(), digest]
    );
    const recordApproval = await createVerifierApprovalRecorder(pool);
    await recordApproval({
      approvalId: intent,
      kind: 'lifecycle',
      effectDigest: digest,
      markerDigest: 'c'.repeat(64),
      expiresAt: row.rows[0].expires_at.toISOString(),
    });
    const proof = await f.db.pool.query(
      'SELECT effect_digest,expires_at FROM experience_authorization.lifecycle_checks WHERE intent_id=$1',
      [intent]
    );
    expect(proof.rows[0].effect_digest).toBe(digest);
    expect(proof.rows[0].expires_at.getTime()).toBeLessThanOrEqual(
      row.rows[0].expires_at.getTime()
    );
    const evidenceId = randomUUID();
    await f.db.pool.query(
      'INSERT INTO experience_evidence(id,merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) SELECT $1,merchant_id,id,attempt_nonce,$3,$3,$4 FROM experience_jobs WHERE id=$2',
      [evidenceId, job, digest, 'https://shop.synthetic.test']
    );
    const draftIntent = randomUUID();
    const draft = await f.db.pool.query(
      "INSERT INTO experience_authorization.apply_intents(id,merchant_id,actor_user_id,build_id,evidence_id,expected_version,retry_key,effect_digest,expires_at) VALUES($1,$2,$3,$4,$5,0,$6,$7,statement_timestamp()+interval '90 seconds') RETURNING expires_at",
      [
        draftIntent,
        f.merchantId,
        owner,
        build,
        evidenceId,
        randomUUID(),
        digest,
      ]
    );
    await recordApproval({
      approvalId: draftIntent,
      kind: 'draft',
      effectDigest: digest,
      markerDigest: 'd'.repeat(64),
      expiresAt: draft.rows[0].expires_at.toISOString(),
    });
    await recordApproval({
      approvalId: draftIntent,
      kind: 'draft',
      effectDigest: digest,
      markerDigest: 'e'.repeat(64),
      expiresAt: draft.rows[0].expires_at.toISOString(),
    });
    const draftProof = await f.db.pool.query(
      'SELECT effect_digest,expires_at FROM experience_authorization.approval_checks WHERE intent_id=$1',
      [draftIntent]
    );
    expect(draftProof.rows[0].effect_digest).toBe(digest);
    expect(draftProof.rows).toHaveLength(2);
    expect(draftProof.rows[0].expires_at.getTime()).toBeLessThanOrEqual(
      draft.rows[0].expires_at.getTime()
    );
    await f.db.pool.query(
      "UPDATE experience_authorization.approval_checks SET verified_at=statement_timestamp()-interval '2 minutes', expires_at=statement_timestamp()-interval '1 minute' WHERE intent_id=$1 AND evidence_digest=$2",
      [draftIntent, 'd'.repeat(64)]
    );
    const fresh = await f.db.pool.query(
      `SELECT EXISTS(SELECT 1 FROM experience_authorization.approval_checks c
        JOIN experience_authorization.apply_intents i ON i.id=c.intent_id
        WHERE i.id=$1 AND c.effect_digest=i.effect_digest
          AND c.verified_at>=i.issued_at AND c.verified_at<=clock_timestamp()
          AND c.expires_at>clock_timestamp() AND c.expires_at<=i.expires_at) AS valid`,
      [draftIntent]
    );
    expect(fresh.rows[0].valid).toBe(true);
    await expect(
      pool.query('SELECT * FROM experience_authorization.lifecycle_checks')
    ).rejects.toThrow();
    await expect(createVerifierCaptureRecorder(f.db.pool)).rejects.toThrow(
      'UNSAFE_VERIFIER_DATABASE_SESSION'
    );
    await f.db.pool.query(
      'GRANT authenticated TO baci_experience_verifier_login'
    );
    await expect(createVerifierCaptureRecorder(pool)).rejects.toThrow(
      'UNSAFE_VERIFIER_DATABASE_SESSION'
    );
  } finally {
    await pool?.end();
    await f.close();
  }
}, 60000);
