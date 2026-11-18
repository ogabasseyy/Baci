/** Disposable database-only fixture rows, not the publication workflow. */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { createCommerceEngineFixture } from './cart-engine-fixture.ts';
export async function seedFixtureOutput(
  f: Awaited<ReturnType<typeof createCommerceEngineFixture>>,
  merchant: string
) {
  const { manifest, compiled } = JSON.parse(
    readFileSync(
      new URL(
        '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/c-compiled-fixture.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const digest = (bytes: Uint8Array | string) =>
    createHash('sha256').update(bytes).digest('hex');
  if (
    compiled.digest !== digest(`${compiled.javascript}\0${compiled.css}`) ||
    compiled.hostOrigin !== 'http://127.0.0.1:43174'
  )
    throw Error('COMPILED_FIXTURE_MISMATCH');
  const image = await sharp({
    create: { width: 240, height: 180, channels: 3, background: '#335577' },
  })
    .png()
    .toBuffer();
  await f.pool.query(
    "INSERT INTO experience_assets(merchant_id,asset_id,digest,purpose,mime,alt,bytes) VALUES($1,'synthetic-device-image',$2,'design','image/png','Synthetic blue QA device',$3)",
    [merchant, digest(image), image]
  );
  const a = randomUUID();
  const j = randomUUID();
  const b = randomUUID();
  const approval = randomUUID();
  const nonce = randomUUID();
  await f.pool.query(
    'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
    [a, merchant, digest(JSON.stringify(manifest)), manifest]
  );
  await f.pool.query(
    "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
    [j, merchant, a, randomUUID(), digest(JSON.stringify(manifest)), nonce]
  );
  await f.pool.query(
    'INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest) VALUES($1,$2,$3,$4,$5)',
    [
      b,
      merchant,
      j,
      compiled.digest,
      JSON.stringify({ fixture: true, hostOrigin: compiled.hostOrigin }),
    ]
  );
  for (const [file, content, mime] of [
    ['app.js', compiled.javascript, 'text/javascript'],
    ['app.css', compiled.css, 'text/css'],
  ]) {
    const bytes = Buffer.from(content);
    await f.pool.query(
      'INSERT INTO experience_build_files VALUES($1,$2,$3,$4,$5,$6)',
      [merchant, b, file, digest(bytes), bytes, mime]
    );
  }
  // Synthetic approval/evidence records exercise read guards only. They confer
  // no real approval and are never copied out of this owned disposable cluster.
  await f.pool.query(
    'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
    [
      merchant,
      j,
      nonce,
      compiled.digest,
      'synthetic-fixture-only',
      compiled.hostOrigin,
    ]
  );
  await f.pool.query(
    'INSERT INTO experience_approvals(id,merchant_id,build_id,effect_digest) VALUES($1,$2,$3,$4)',
    [approval, merchant, b, compiled.digest]
  );
  await f.pool.query(
    'INSERT INTO experience_published_heads VALUES($1,$2,$3,1)',
    [merchant, b, approval]
  );
  return { image };
}
