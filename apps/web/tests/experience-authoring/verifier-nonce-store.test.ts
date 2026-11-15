import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import {
  verifierDatabaseDeadlines,
  verifyVerifierDatabaseDeadlines,
} from '../../tools/experience-verifier/database-role';
import { createVerifierNonceStore } from '../../tools/experience-verifier/nonce-store';
import { experienceDataFixture } from './data-fixture.test-support';

vi.mock('server-only', () => ({}));

it('uses a restricted durable single-use ledger across concurrency and restart', async () => {
  const f = await experienceDataFixture();
  let pool: Pool | undefined;
  let restarted: Pool | undefined;
  try {
    if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
    await f.db.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261111232000_experience_verifier_nonces.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await f.db.pool.query(
      'CREATE ROLE baci_experience_verifier_login LOGIN NOINHERIT; GRANT baci_experience_verifier TO baci_experience_verifier_login'
    );
    const config = {
      host: f.db.localDatabase.socketDirectory,
      user: 'baci_experience_verifier_login',
      database: 'postgres',
      options: '-c role=baci_experience_verifier',
    };
    pool = new Pool({ ...config, ...verifierDatabaseDeadlines, max: 4 });
    await verifyVerifierDatabaseDeadlines(pool);
    const consume = await createVerifierNonceStore(pool);
    const lock = await f.db.pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query(
        'LOCK TABLE experience_authorization.verifier_nonces IN ACCESS EXCLUSIVE MODE'
      );
      await expect(
        consume('c'.repeat(64), Date.now() + 30000)
      ).rejects.toMatchObject({
        code: '55P03',
      });
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    await expect(pool.query('SELECT pg_sleep(5)')).rejects.toMatchObject({
      code: '57014',
    });
    const expires = Date.now() + 30000;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consume('a'.repeat(64), expires))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    await pool.end();
    pool = undefined;
    restarted = new Pool(config);
    await expect(verifyVerifierDatabaseDeadlines(restarted)).rejects.toThrow(
      'UNBOUNDED_VERIFIER_DATABASE_SESSION'
    );
    expect(
      await (await createVerifierNonceStore(restarted))('a'.repeat(64), expires)
    ).toBe(false);
    expect(
      await (await createVerifierNonceStore(restarted))('b'.repeat(64), expires)
    ).toBe(true);
    expect(
      (
        await restarted.query(
          'DELETE FROM experience_authorization.verifier_nonces'
        )
      ).rowCount
    ).toBe(0);
    await expect(
      restarted.query(
        'SELECT nonce FROM experience_authorization.verifier_nonces'
      )
    ).rejects.toThrow();
    await expect(createVerifierNonceStore(f.db.pool)).rejects.toThrow(
      'UNSAFE_VERIFIER_DATABASE_SESSION'
    );
  } finally {
    await pool?.end();
    await restarted?.end();
    await f.close();
  }
}, 60000);
