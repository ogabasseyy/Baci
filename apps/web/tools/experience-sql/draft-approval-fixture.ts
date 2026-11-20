import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { experienceSqlFixture } from './fixture.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export async function setupDraftApproval(
  f: Awaited<ReturnType<typeof experienceSqlFixture>>
) {
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
  return { owner, other, merchant, artifact, build, evidence };
}
