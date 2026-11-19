import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { hash, lifecycleFixture } from './sql.test-support';

it('reports the 30-day window and three verified targets, then reads the retained renderer after a trial rollback', async () => {
  const f = await lifecycleFixture();
  const asOf = Date.parse('2026-11-19T12:00:00Z');
  const at = (days: number) => new Date(asOf + 86_400_000 * days);
  try {
    for (const migration of [
      '20261024074638_experience_private_preview.sql',
      '20261025220000_experience_public_prerender_binding.sql',
      '20261119103000_experience_verified_renderer_storage.sql',
    ]) {
      await f.pool.query(
        readFileSync(
          new URL(
            `../../../../supabase/migrations/${migration}`,
            import.meta.url
          ),
          'utf8'
        )
      );
    }
    async function build(name: string) {
      const b = await f.build(name);
      await f.pool.query(
        `WITH evidence AS (
           UPDATE public.experience_evidence SET verified_at=$3 WHERE id=$1 RETURNING job_id,attempt_nonce
         )
         INSERT INTO experience_authorization.verified_renderers(job_id, attempt_nonce, renderer)
         SELECT job_id, attempt_nonce, $2::jsonb FROM evidence`,
        [b.evidence, { digest: b.digest, javascript: name }, at(-160)]
      );
      return b;
    }
    const expired = await build('expired');
    const pendingRollback = await build('pending-rollback');
    const boundary = await build('long-serving');
    const first = await build('first-verified');
    const unverified = await build('unverified-release');
    const second = await build('second-verified');
    const third = await build('third-verified');
    const live = await build('live');
    const draft = await build('saved-draft');
    const pending = await build('pending-apply');
    const preview = await build('active-preview');
    const unused = await build('old-unused');
    const inFlight = await build('in-flight');
    const terminal = randomUUID();
    await f.pool.query(
      `WITH job AS (
         INSERT INTO public.experience_jobs
           (id,merchant_id,artifact_id,retry_key,source_digest,status,expires_at)
         VALUES ($1,$2,$3,$1,$4,'failed',$5) RETURNING id,attempt_nonce
       ), evidence AS (
         INSERT INTO public.experience_evidence
           (job_id,attempt_nonce,merchant_id,build_digest,receipt_digest,host_origin,verified_at)
         SELECT id,attempt_nonce,$2,$6,$6,'http://127.0.0.1:43174',$5 FROM job
         RETURNING job_id,attempt_nonce
       )
       INSERT INTO experience_authorization.verified_renderers(job_id,attempt_nonce,renderer)
       SELECT job_id,attempt_nonce,jsonb_build_object('digest',$6::text) FROM evidence`,
      [
        terminal,
        f.merchantId,
        unused.artifact,
        hash('old-unused'),
        at(-3),
        unused.digest,
      ]
    );
    await f.pool.query(
      `UPDATE public.experience_jobs SET status='verified'
       WHERE id=(SELECT job_id FROM public.experience_builds WHERE id=$1)`,
      [inFlight.id]
    );
    let revision = 0;
    async function intentFor(
      buildId: string | null,
      date: Date,
      action: 'publish' | 'rollback' | 'draft-only'
    ) {
      const intent = randomUUID();
      const effect = hash(intent);
      await f.pool.query(
        `INSERT INTO experience_authorization.lifecycle_intents
         (id,merchant_id,actor_user_id,retry_key,action,payload,effect_digest,snapshot,issued_at,expires_at)
         VALUES ($1,$2,$3,$1,$4,jsonb_build_object('buildId',$5::text),$6,'{}',$7,$7::timestamptz + interval '10 minutes')`,
        [intent, f.merchantId, f.actor, action, buildId, effect, date]
      );
      return { intent, effect };
    }
    async function release(
      buildId: string | null,
      date: Date,
      verified: boolean,
      action: 'publish' | 'rollback' | 'draft-only' = 'publish'
    ) {
      const { intent, effect } = await intentFor(buildId, date, action);
      const receipt = randomUUID();
      await f.pool.query(
        `INSERT INTO experience_authorization.lifecycle_receipts
         (id,intent_id,merchant_id,build_id,publication_revision,action,committed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [receipt, intent, f.merchantId, buildId, ++revision, action, date]
      );
      if (verified) {
        await f.pool.query(
          `INSERT INTO experience_authorization.lifecycle_checks
           (intent_id,receipt_id,kind,effect_digest,marker_digest,verified_at,expires_at)
           VALUES ($1,$2,'public',$3,$3,$4,$4::timestamptz+interval '5 minutes')`,
          [intent, receipt, effect, date]
        );
      }
    }
    await release(expired.id, at(-140), true);
    await release(pendingRollback.id, at(-120), true);
    await release(boundary.id, at(-100), true);
    await release(null, at(-45), false, 'draft-only');
    await release(first.id, at(-30), true);
    await release(unverified.id, at(-26), false);
    await release(second.id, at(-20), true);
    await release(second.id, at(-19), true, 'rollback');
    await release(third.id, at(-15), true);
    await release(live.id, at(-10), true);
    await intentFor(pendingRollback.id, at(0), 'rollback');
    await f.pool.query(
      `WITH approval AS (
         INSERT INTO public.experience_approvals(merchant_id,build_id,effect_digest)
         VALUES ($1,$2,$3) RETURNING id
       )
       INSERT INTO public.experience_published_heads(merchant_id,build_id,approval_id,publication_revision)
       SELECT $1,$2,id,$4 FROM approval`,
      [f.merchantId, live.id, hash('live effect'), revision]
    );
    await f.pool.query(
      'INSERT INTO public.experience_draft_heads(merchant_id,build_id,version) VALUES ($1,$2,1)',
      [f.merchantId, draft.id]
    );
    await f.pool.query(
      `INSERT INTO public.experience_preview_bindings(merchant_id,build_id,actor_user_id,expires_at)
       VALUES ($1,$2,$3,$4::timestamptz + interval '10 minutes')`,
      [f.merchantId, preview.id, f.actor, at(0)]
    );
    await f.pool.query(
      `INSERT INTO experience_authorization.apply_intents
        (merchant_id,actor_user_id,build_id,evidence_id,expected_version,retry_key,effect_digest,issued_at,expires_at)
        VALUES ($1,$2,$3,$4,1,$5,$6,$7,$7::timestamptz + interval '10 minutes')`,
      [
        f.merchantId,
        f.actor,
        pending.id,
        pending.evidence,
        randomUUID(),
        hash('pending'),
        at(0),
      ]
    );
    const sql = readFileSync(
      new URL(
        '../../tools/experience-verifier/renderer-retention-dry-run.sql',
        import.meta.url
      ),
      'utf8'
    );
    await f.c.query('BEGIN READ ONLY');
    try {
      const report = async (days: number, merchant = f.merchantId) => {
        const result = await f.c.query<{
          build_id: string | null;
          decision: string;
          job_id: string;
          renderer_bytes: number;
        }>(sql, [merchant, at(days)]);
        expect(result.rows.every((row) => row.renderer_bytes > 0)).toBe(true);
        return Object.fromEntries(
          result.rows.map((row) => [row.build_id ?? row.job_id, row.decision])
        );
      };
      const now = await report(0);
      expect(now).toEqual({
        [expired.id]: 'candidate_expired_release',
        [pendingRollback.id]: 'keep_active_reference',
        [boundary.id]: 'keep_rollback_window',
        [first.id]: 'keep_verified_floor',
        [unverified.id]: 'keep_rollback_window',
        [second.id]: 'keep_verified_floor',
        [third.id]: 'keep_verified_floor',
        [live.id]: 'keep_published_head',
        [draft.id]: 'keep_draft_head',
        [pending.id]: 'keep_active_reference',
        [preview.id]: 'keep_active_reference',
        [unused.id]: 'candidate_expired_draft',
        [inFlight.id]: 'keep_in_flight',
        [terminal]: 'candidate_expired_attempt',
      });
      const later = await report(60);
      expect(later[boundary.id]).toBe('candidate_expired_release');
      expect(later[unverified.id]).toBe('candidate_expired_release');
      expect(later[pendingRollback.id]).toBe('candidate_expired_release');
      expect(later[preview.id]).toBe('candidate_expired_draft');
      expect(later[first.id]).toBe('keep_verified_floor');
      expect(later[second.id]).toBe('keep_verified_floor');
      expect(later[third.id]).toBe('keep_verified_floor');
      expect(await report(0, randomUUID())).toEqual({});
      console.info('Renderer dry run: 11 kept, 3 candidates, 0 writes');
    } finally {
      await f.c.query('ROLLBACK');
    }
    const session = randomUUID();
    await f.c.query('BEGIN');
    try {
      await f.c.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [
        session,
        f.actor,
      ]);
      await f.c.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: f.actor,
          role: 'authenticated',
          session_id: session,
        }),
      ]);
      const firstBinding = [
        'approval-fixture',
        f.merchantId,
        first.id,
        first.digest,
        hash('first-verified'),
      ];
      const read =
        'SELECT experience_authorization.read_published_verified_renderer($1,$2,$3,$4,$5) renderer';
      await f.c.query('SET LOCAL ROLE baci_experience_renderer_reader');
      expect((await f.c.query(read, firstBinding)).rows).toEqual([
        { renderer: null },
      ]);
      await f.c.query('SET LOCAL ROLE authenticated');
      const intent = (
        await f.c.query(
          "SELECT public.experience_request_lifecycle($1,$2,1,'rollback',$3,$4) result",
          [
            f.merchantId,
            f.connection,
            {
              buildId: first.id,
              expectedDraftVersion: 1,
              expectedPublishedVersion: revision,
            },
            randomUUID(),
          ]
        )
      ).rows[0].result;
      expect(intent.status).toBe('confirmation-required');
      await f.c.query('SET LOCAL ROLE baci_experience_verifier');
      await f.c.query(
        `INSERT INTO experience_authorization.lifecycle_checks
         (intent_id,kind,effect_digest,marker_digest)
         VALUES ($1,'render',$2,$3)`,
        [
          intent.approvalId,
          intent.effectDigest,
          hash('synthetic-render-marker'),
        ]
      );
      await f.c.query('SET LOCAL ROLE authenticated');
      const receipt = (
        await f.c.query(
          'SELECT public.experience_confirm_publication($1) result',
          [intent.approvalId]
        )
      ).rows[0].result;
      expect(receipt).toMatchObject({
        buildId: first.id,
        publishedVersion: revision + 1,
      });
      await f.c.query('SET LOCAL ROLE baci_experience_renderer_reader');
      expect((await f.c.query(read, firstBinding)).rows).toEqual([
        { renderer: { digest: first.digest, javascript: 'first-verified' } },
      ]);
    } finally {
      await f.c.query('ROLLBACK');
    }
    expect(
      (
        await f.pool.query(
          `SELECT build_id, (SELECT count(*)::int FROM experience_authorization.verified_renderers) renderer_count
         FROM public.experience_published_heads WHERE merchant_id=$1`,
          [f.merchantId]
        )
      ).rows
    ).toEqual([{ build_id: live.id, renderer_count: 14 }]);
  } finally {
    await f.close();
  }
}, 30000);
