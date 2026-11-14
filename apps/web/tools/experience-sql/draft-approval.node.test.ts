import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asActor, experienceSqlFixture } from './fixture.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('publication: private intent is owner/evidence/version bound, replay-safe and never publishes', async () => {
  const f = await experienceSqlFixture({ asyncEdits: true });
  const c = await f.pool.connect();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073157_experience_private_uploads.sql',
      '20261025060500_experience_upload_manifest_validation.sql',
      '20261024073533_experience_job_and_draft_lifecycle.sql',
      ...(process.env.BACI_D_RED
        ? []
        : ['20261024171619_experience_owner_intents.sql']),
      '20261028162326_experience_retry_build_quota.sql',
      '20261103161500_experience_https_build_origins.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const owner = randomUUID();
    const other = randomUUID();
    const merchant = randomUUID();
    const artifact = randomUUID();
    const job = randomUUID();
    const build = randomUUID();
    const evidence = randomUUID();
    const nonce = randomUUID();
    const retry = randomUUID();
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1),($2)', [
      owner,
      other,
    ]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      owner,
    ]);
    await f.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [
        artifact,
        merchant,
        hash('source'),
        { routes: [], assets: [], capabilities: [] },
      ]
    );
    await f.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, merchant, artifact, randomUUID(), hash('source'), nonce]
    );
    await f.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,$4,'[]','http://127.0.0.1:4100')",
      [build, merchant, job, hash('export{}\0')]
    );
    await f.pool.query(
      "INSERT INTO experience_evidence(id,merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6,'http://127.0.0.1:4100')",
      [evidence, merchant, job, nonce, hash('export{}\0'), hash('receipt')]
    );
    for (const [path, bytes, mime] of [
      ['app.js', 'export{}', 'text/javascript'],
      ['app.css', '', 'text/css'],
    ])
      await f.pool.query(
        'INSERT INTO experience_build_files(merchant_id,build_id,path,bytes,digest,mime) VALUES($1,$2,$3,$4,$5,$6)',
        [merchant, build, path, Buffer.from(bytes), hash(bytes), mime]
      );
    const request = (
      actor = owner,
      overrides: { evidence?: string; expected?: number; build?: string } = {}
    ) =>
      asActor(c, actor, () =>
        c.query(
          'SELECT experience_request_draft_apply($1,null,null,$2,$3,$4,$5) result',
          [
            merchant,
            overrides.build ?? build,
            overrides.evidence ?? evidence,
            overrides.expected ?? 0,
            retry,
          ]
        )
      );
    const initial = (await request()).rows[0].result;
    assert.equal(initial.status, 'confirmation-required');
    assert.deepEqual((await request()).rows[0].result, initial);
    await assert.rejects(request(other), /NOT_FOUND/);
    await assert.rejects(
      request(owner, { expected: 1 }),
      /IDEMPOTENCY_CONFLICT/
    );
    await assert.rejects(
      request(owner, { evidence: randomUUID() }),
      /IDEMPOTENCY_CONFLICT/
    );
    const load = () =>
      asActor(c, owner, () =>
        c.query('SELECT experience_load_draft_approval($1) result', [
          initial.approvalId,
        ])
      );
    assert.equal((await load()).rows[0].result.buildId, build);
    await assert.rejects(
      asActor(c, other, () =>
        c.query('SELECT experience_load_draft_approval($1)', [
          initial.approvalId,
        ])
      ),
      /NOT_FOUND/
    );
    await assert.rejects(
      asActor(c, owner, () =>
        c.query(
          'UPDATE experience_authorization.apply_intents SET expires_at=now()'
        )
      ),
      /permission denied/
    );
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM experience_draft_heads'))
        .rows[0].count,
      '0'
    );
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count,
      '0'
    );
    await f.pool.query(
      "UPDATE experience_build_files SET bytes=convert_to('corrupted','UTF8') WHERE build_id=$1 AND path='app.js'",
      [build]
    );
    await assert.rejects(load(), /STALE_OR_UNVERIFIED_BUILD/);
    await f.pool.query(
      "UPDATE experience_build_files SET bytes=convert_to('export{}','UTF8') WHERE build_id=$1 AND path='app.js'",
      [build]
    );
    await f.pool.query(
      "UPDATE experience_artifacts SET manifest='{" +
        '"assets":[],"routes":[],"capabilities":["navigation"]' +
        "}' WHERE id=$1",
      [artifact]
    );
    await assert.rejects(load(), /APPROVAL_MISMATCH/);
    await f.pool.query(
      "UPDATE experience_authorization.apply_intents SET issued_at=now()-interval '20 minutes',expires_at=now()-interval '11 minutes' WHERE id=$1",
      [initial.approvalId]
    );
    await assert.rejects(load(), /APPROVAL_EXPIRED/);
    assert.equal(
      (await request()).rows[0].result.approvalId,
      initial.approvalId
    );

    await f.pool.query(
      'UPDATE experience_artifacts SET manifest=$2 WHERE id=$1',
      [artifact, { routes: [], assets: [], capabilities: [] }]
    );
    await f.pool.query(
      "UPDATE experience_authorization.apply_intents SET issued_at=clock_timestamp(),expires_at=clock_timestamp()+interval '9 minutes' WHERE id=$1",
      [initial.approvalId]
    );
    await assert.rejects(
      asActor(c, owner, () =>
        c.query('SELECT experience_confirm_draft_apply($1)', [
          initial.approvalId,
        ])
      ),
      /RUNTIME_NOT_QUALIFIED/
    );
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261024172102_experience_legacy_mode_guards.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const lease = (
      await asActor(c, owner, () =>
        c.query('SELECT experience_begin_legacy_execution($1) id', [merchant])
      )
    ).rows[0].id;
    const confirm = () =>
      asActor(c, owner, () =>
        c.query('SELECT experience_confirm_draft_apply($1) result', [
          initial.approvalId,
        ])
      );
    await assert.rejects(confirm(), /PREVIEW_REQUIRED/);
    await assert.rejects(
      asActor(c, owner, () =>
        c.query(
          "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,expires_at) VALUES($1,$2,$3,now()+interval '8 minutes')",
          [initial.approvalId, initial.effectDigest, hash('render')]
        )
      ),
      /permission denied/
    );
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE baci_experience_verifier');
    await c.query(
      "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '8 minutes')",
      [initial.approvalId, initial.effectDigest, hash('render')]
    );
    await c.query('COMMIT');
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261111231000_experience_approval_retry_proofs.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await f.pool.query(
      "UPDATE experience_authorization.approval_checks SET verified_at=clock_timestamp()-interval '30 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE intent_id=$1",
      [initial.approvalId]
    );
    await assert.rejects(confirm(), /PREVIEW_REQUIRED/);
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE baci_experience_verifier');
    await c.query(
      "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '8 minutes')",
      [initial.approvalId, initial.effectDigest, hash('fresh-render')]
    );
    await c.query('COMMIT');
    await assert.rejects(confirm(), /LEGACY_EXECUTION_ACTIVE/);
    // Time passage is not worker completion/cancellation acknowledgement.
    await f.pool.query(
      "UPDATE experience_authorization.legacy_execution_leases SET created_at=now()-interval '1 day'"
    );
    await assert.rejects(confirm(), /LEGACY_EXECUTION_ACTIVE/);
    await assert.rejects(
      asActor(c, other, () =>
        c.query('SELECT experience_complete_legacy_execution($1,$2)', [
          merchant,
          lease,
        ])
      ),
      /NOT_FOUND/
    );
    await asActor(c, owner, () =>
      c.query('SELECT experience_complete_legacy_execution($1,$2)', [
        merchant,
        lease,
      ])
    );
    const competitor = await f.pool.connect();
    try {
      await asActor(c, owner, async () => {
        await c.query('SELECT public.builder_website_guard($1)', [merchant]);
        await assert.rejects(
          asActor(competitor, owner, () =>
            competitor.query('SELECT experience_confirm_draft_apply($1)', [
              initial.approvalId,
            ])
          ),
          /website_busy/
        );
      });
    } finally {
      competitor.release();
    }
    const applied = (await confirm()).rows[0].result;
    assert.deepEqual(applied, { buildId: build, version: 1 });
    assert.deepEqual((await confirm()).rows[0].result, applied);
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count,
      '0'
    );
    for (const sql of [
      "SELECT builder_private_save($1,'home','Home','{}',null,null,null,null)",
      "SELECT builder_private_publish($1,'home',null,'layout')",
      "SELECT builder_queue_edit(null,null,$1,null,null,'change')",
      'SELECT builder_claim_edit(null,null,$1,null)',
      "SELECT builder_finish_edit(null,null,$1,null,null,'ready',null)",
      'SELECT builder_prepare_apply(null,null,$1,null)',
      'SELECT builder_apply_operation(null,null,$1,null,null,null)',
      'SELECT builder_load_edit_lease(null,null,$1,null,null)',
    ])
      await assert.rejects(
        asActor(c, owner, () => c.query(sql, [merchant])),
        /FULL_CODE_ACTIVE/
      );
    await assert.rejects(
      asActor(c, owner, () =>
        c.query('SELECT experience_begin_legacy_execution($1)', [merchant])
      ),
      /FULL_CODE_ACTIVE/
    );
    await assert.rejects(
      asActor(c, owner, () =>
        c.query('SELECT experience_require_legacy($1)', [merchant])
      ),
      /FULL_CODE_ACTIVE/
    );
  } finally {
    c.release();
    await f.close();
  }
});
