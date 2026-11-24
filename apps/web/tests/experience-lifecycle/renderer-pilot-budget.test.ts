import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { hash, lifecycleFixture } from './sql.test-support';

vi.mock('server-only', () => ({}));

it('counts retained attempts and atomically rejects writes at the pilot budget', async () => {
  const f = await lifecycleFixture();
  const renderer = { digest: hash('synthetic'), javascript: 'export{}' };
  const schema = 'experience_authorization';
  const budget = `${schema}.renderer_pilot_budget`;
  const bytes = async () =>
    (
      await f.pool.query<{ bytes: number }>(
        'SELECT octet_length(($1::jsonb)::text) AS bytes',
        [renderer]
      )
    ).rows[0].bytes;
  const migration = (name: string) =>
    f.pool.query(
      readFileSync(
        new URL(`../../../../supabase/migrations/${name}.sql`, import.meta.url),
        'utf8'
      )
    );
  const newAttempt = async (label: string) => {
    const job = randomUUID();
    const attempt = randomUUID();
    const artifact = randomUUID();
    const digest = hash(label);
    await f.pool.query(
      "INSERT INTO public.experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,'{}')",
      [artifact, f.merchantId, digest]
    );
    await f.pool.query(
      "INSERT INTO public.experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status,expires_at) VALUES($1,$2,$3,$1,$4,$5,'running',now()+interval '1 hour')",
      [job, f.merchantId, artifact, digest, attempt]
    );
    return {
      job,
      args: [
        f.merchantId,
        job,
        attempt,
        digest,
        digest,
        'http://127.0.0.1:43174',
      ],
    };
  };
  const record = async ({ args }: Awaited<ReturnType<typeof newAttempt>>) => {
    const client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE baci_experience_verifier');
      await client.query(
        `SELECT ${schema}.record_verified_renderer($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [...args, renderer]
      );
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };
  try {
    for (const name of [
      '20261025220000_experience_public_prerender_binding',
      '20261119103000_experience_verified_renderer_storage',
    ])
      await migration(name);
    const before = await newAttempt('existing renderer');
    await record(before);
    await f.pool.query(
      "UPDATE public.experience_jobs SET status='failed' WHERE id=$1",
      [before.job]
    );
    await migration('20261124072648_experience_renderer_pilot_budget');
    const size = await bytes();
    const readBudget = async () =>
      (
        await f.pool.query(
          `SELECT used_bytes::int AS used, max_bytes::int AS max FROM ${budget}`
        )
      ).rows[0];
    expect(await readBudget()).toEqual({ used: size, max: 256 * 1024 * 1024 });
    await f.pool.query(`UPDATE ${budget} SET max_bytes=$1`, [2 * size]);

    const first = await newAttempt('concurrent A');
    const second = await newAttempt('concurrent B');
    const outcomes = await Promise.allSettled([record(first), record(second)]);
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: '23514', message: 'RENDERER_STORAGE_LIMIT' },
    });
    const rejectedJob =
      outcomes[0].status === 'rejected' ? first.job : second.job;
    expect(
      (
        await f.pool.query(
          'SELECT 1 FROM public.experience_evidence WHERE job_id=$1',
          [rejectedJob]
        )
      ).rowCount
    ).toBe(0);
    expect(await readBudget()).toEqual({ used: 2 * size, max: 2 * size });
    expect(
      (await f.pool.query(`SELECT 1 FROM ${schema}.verified_renderers`))
        .rowCount
    ).toBe(2);
    expect(
      (
        await f.pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [
          'baci_experience_verifier',
          budget,
          'SELECT, UPDATE',
        ])
      ).rows[0].allowed
    ).toBe(false);
  } finally {
    await f.close();
  }
});
