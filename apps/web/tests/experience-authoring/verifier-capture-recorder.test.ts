import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { snapshotKeyDigest } from '@/lib/experience/snapshot-key';
import { createVerifierCaptureRecorder } from '../../tools/experience-verifier/capture-recorder';
import { experienceDataFixture } from './data-fixture.test-support';

vi.mock('server-only', () => ({}));

it('writes a verified capture only through the restricted verifier role', async () => {
  const f = await experienceDataFixture();
  let pool: Pool | undefined;
  try {
    if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
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
