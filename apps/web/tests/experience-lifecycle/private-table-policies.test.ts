import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { lifecycleFixture } from './sql.test-support';

it('detects disabled RLS and unsafe direct grants on every previously omitted private table', async () => {
  const f = await lifecycleFixture();
  try {
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261024074638_experience_private_preview.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const checks = ['private-foundation.sql', 'private-later-tables.sql']
      .map((name) =>
        readFileSync(
          new URL(
            `../../../../supabase/tests/experience/${name}`,
            import.meta.url
          ),
          'utf8'
        )
      )
      .join('\n');
    await f.pool.query(checks);
    for (const table of [
      'experience_build_files',
      'experience_uploads',
      'experience_chunks',
      'experience_source_heads',
      'experience_preview_bindings',
      'experience_snapshots',
    ]) {
      await f.pool.query(
        `ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY`
      );
      try {
        await expect(f.pool.query(checks)).rejects.toThrow(
          `RLS missing: ${table}`
        );
      } finally {
        await f.pool.query(
          `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
        );
      }
      await f.pool.query(`GRANT INSERT ON public.${table} TO authenticated`);
      try {
        await expect(f.pool.query(checks)).rejects.toThrow(
          `unsafe direct grants: ${table}`
        );
      } finally {
        await f.pool.query(
          `REVOKE INSERT ON public.${table} FROM authenticated`
        );
      }
    }
    await f.pool.query(checks);
  } finally {
    await f.close();
  }
});
