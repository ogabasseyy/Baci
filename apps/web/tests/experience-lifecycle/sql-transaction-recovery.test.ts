import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { lifecycleFixture } from './sql.test-support';

it('keeps the shared fixture connection usable after a verifier insert fails', async () => {
  const f = await lifecycleFixture();
  try {
    const build = await f.build('synthetic-rollback-recovery');
    await f.pool.query(`CREATE FUNCTION experience_authorization.synthetic_reject_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic verifier write failed'; END $$;
      CREATE TRIGGER synthetic_reject_check BEFORE INSERT ON experience_authorization.approval_checks FOR EACH ROW EXECUTE FUNCTION experience_authorization.synthetic_reject_check();`);
    await expect(f.apply(build, 0)).rejects.toThrow(
      'synthetic verifier write failed'
    );
    expect((await f.c.query('SELECT 1 AS healthy')).rows[0].healthy).toBe(1);
    expect(
      (await f.pool.query('SELECT count(*)::int n FROM experience_draft_heads'))
        .rows[0].n
    ).toBe(0);
  } finally {
    await f.close();
  }
});
