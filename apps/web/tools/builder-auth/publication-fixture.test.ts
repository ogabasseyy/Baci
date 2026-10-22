// @vitest-environment node
import { expect, it } from 'vitest';
import { draftFixture } from './draft-fixture';

it.skipIf(process.env.BACI_BUILDER_LOCAL_PG !== '1')(
  'replays existing private-draft/async migrations on isolated PostgreSQL18 without Docker',
  async () => {
    const db = await draftFixture({ local: true, asyncEdits: true });
    try {
      expect(
        (
          await db.pool.query(
            "SELECT to_regclass('public.builder_page_drafts') table_name"
          )
        ).rows[0].table_name
      ).toBe('builder_page_drafts');
    } finally {
      await db.close();
    }
  },
  30000
);
