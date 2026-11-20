import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { experienceDataFixture } from './data-fixture.test-support';

export async function setupVerifierPool(
  f: Awaited<ReturnType<typeof experienceDataFixture>>
) {
  if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
  for (const migration of [
    '20261111232000_experience_verifier_nonces.sql',
    '20261111231000_experience_approval_retry_proofs.sql',
    '20261112002500_experience_capture_idempotency.sql',
  ]) {
    await f.db.pool.query(
      readFileSync(
        new URL(
          `../../../../supabase/migrations/${migration}`,
          import.meta.url
        ),
        'utf8'
      )
    );
  }
  await f.db.pool.query(
    'CREATE ROLE baci_experience_verifier_login LOGIN NOINHERIT; GRANT baci_experience_verifier TO baci_experience_verifier_login'
  );
  return new Pool({
    host: f.db.localDatabase.socketDirectory,
    user: 'baci_experience_verifier_login',
    database: 'postgres',
    options: '-c role=baci_experience_verifier',
  });
}
