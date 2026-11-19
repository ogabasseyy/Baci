import { createHash, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createVerifierBuildRecorder } from '../../tools/experience-verifier/build-recorder';
import { experienceDataFixture } from './data-fixture.test-support';
import { seedSyntheticPublicRead } from './synthetic-public-read.test-support';
import { setupVerifierPool } from './verifier-pool.test-support';

vi.mock('server-only', () => ({}));

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

it('finalizes only with an exact verifier-retained renderer and keeps owner reads scoped', async () => {
  const f = await experienceDataFixture();
  try {
    const artifact = randomUUID();
    const source = hash('synthetic source');
    await f.db.pool.query(
      "INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,'{}')",
      [artifact, f.merchantId, source]
    );
    const owner = {
      p_merchant: f.merchantId,
      p_connection: f.connectionId,
      p_version: 1,
    };
    const queued = await f.owner.supabase.rpc('experience_queue_build', {
      ...owner,
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
    const attempt = row.data?.attempt_nonce;
    expect(attempt).toBeTruthy();
    const claim = { ...owner, p_job: job, p_attempt: attempt };
    expect(
      (await f.owner.supabase.rpc('experience_claim_build', claim)).error
    ).toBeNull();

    const javascript = 'export{}';
    const renderer = {
      javascript: 'export default function View(){}',
      css: '',
      imports: [],
      digest: hash('export default function View(){}\0'),
    };
    const build = hash(`${javascript}\0`);
    const receipt = hash('synthetic receipt');
    const host = 'https://merchant.synthetic.test';
    const input = {
      ...claim,
      p_source: source,
      p_build: build,
      p_receipt: receipt,
      p_retry: job,
      p_host_origin: host,
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

    const finalize = () =>
      f.owner.supabase.rpc('experience_finalize_prerender_build', input);
    const verifier = await f.db.pool.connect();
    const receiptArgs = [f.merchantId, job, attempt, build, receipt, host];
    try {
      await verifier.query('BEGIN');
      await verifier.query('SET LOCAL ROLE baci_experience_verifier');
      await expect(
        verifier.query(
          'SELECT experience_authorization.record_verified_renderer($1,$2,$3,$4,$5,$6,$7::jsonb)',
          [...receiptArgs, '{}']
        )
      ).rejects.toMatchObject({ code: '23514' });
      await verifier.query('ROLLBACK');
      expect(
        (
          await verifier.query(
            'SELECT 1 FROM experience_evidence WHERE job_id=$1',
            [job]
          )
        ).rowCount
      ).toBe(0);
      await verifier.query('BEGIN');
      await verifier.query('SET LOCAL ROLE baci_experience_verifier');
      await verifier.query(
        'INSERT INTO public.experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
        receiptArgs
      );
      await verifier.query('COMMIT');
      const missing = await finalize();
      expect(missing.error?.message).toContain('RENDERER_NOT_RETAINED');
      expect(
        (
          await f.owner.supabase
            .from('experience_jobs')
            .select('status')
            .eq('id', job)
            .single()
        ).data?.status
      ).toBe('running');
      await verifier.query('DELETE FROM experience_evidence WHERE job_id=$1', [
        job,
      ]);
    } finally {
      await verifier.query('ROLLBACK');
      verifier.release();
    }

    const writer = await setupVerifierPool(f);
    try {
      const record = await createVerifierBuildRecorder(writer);
      await record(
        {
          merchantId: f.merchantId,
          jobId: job,
          attemptNonce: attempt as string,
          buildDigest: build,
          receiptDigest: receipt,
          hostOrigin: host,
        },
        renderer
      );
    } finally {
      await writer.end();
    }

    const finalized = await finalize();
    expect(finalized.error).toBeNull();
    expect(finalized.data).toEqual(expect.any(String));
    expect((await finalize()).data).toBe(finalized.data);
    const read = {
      ...owner,
      p_build_id: finalized.data,
      p_digest: build,
      p_source: source,
    };
    expect(
      (await f.owner.supabase.rpc('experience_read_prerender_build', read)).data
    ).toEqual(renderer);
    expect(
      (await f.other.supabase.rpc('experience_read_prerender_build', read))
        .error
    ).not.toBeNull();
    expect(
      (await f.anonymous.rpc('experience_read_prerender_build', read)).error
    ).not.toBeNull();
    expect(
      (
        await f.owner.supabase.rpc('experience_read_prerender_build', {
          ...read,
          p_source: hash('other'),
        })
      ).data
    ).toBeNull();

    const slug = 'synthetic-renderer';
    await f.db.pool.query(
      'UPDATE merchants SET slug=$2,is_published=false WHERE id=$1',
      [f.merchantId, slug]
    );
    const reader = await f.db.pool.connect();
    try {
      await reader.query('BEGIN');
      await reader.query('SET LOCAL ROLE baci_experience_renderer_reader');
      const query =
        'SELECT experience_authorization.read_published_verified_renderer($1,$2,$3,$4,$5) AS renderer';
      const published = [slug, f.merchantId, finalized.data, build, source];
      expect((await reader.query(query, published)).rows).toEqual([
        { renderer: null },
      ]);
      await reader.query('COMMIT');
      await seedSyntheticPublicRead(f, f.merchantId, finalized.data as string);
      await reader.query('BEGIN');
      await reader.query('SET LOCAL ROLE baci_experience_renderer_reader');
      expect((await reader.query(query, published)).rows).toEqual([
        { renderer },
      ]);
      expect(
        (
          await reader.query(query, [
            slug,
            f.merchantId,
            randomUUID(),
            build,
            source,
          ])
        ).rows
      ).toEqual([{ renderer: null }]);
      await expect(
        reader.query(
          'SELECT renderer FROM experience_authorization.verified_renderers'
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await reader.query('ROLLBACK');
      reader.release();
    }
  } finally {
    await f.close();
  }
}, 30000);
